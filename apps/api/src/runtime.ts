import {
  runPipeline,
  resolve,
  nicheGate,
  renderMessage,
  validateMessage,
  type ProductReader,
  type Publisher,
} from '@mandaolink/core';
import { buildApp, type AppOptions } from './app.js';
import { startHeartbeat } from './heartbeat.js';
import { createPipelineStore, loadPipelineConfig } from './pipeline-store.js';
import { createQueueStore } from './queue-store.js';
import { startQueueWorker, type BossClient } from './queue-worker.js';
import { createPushService } from './push.js';

export interface IncomingMessage {
  sourceId: string;
  externalId: string;
  text: string;
  link?: string | null;
  publishedAt: number;
  advertisedPriceCents?: number | null;
}
export interface SourceConnector {
  start(accept: (message: IncomingMessage) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}
export interface RuntimeConnectors {
  source: SourceConnector;
  reader: ProductReader & { close?(): Promise<void> };
  publisher: Publisher;
  resolve?: typeof resolve;
}
export function runtimeFlags(env: NodeJS.ProcessEnv) {
  const mode = env.CONNECTORS ?? 'fake',
    dry = env.DRY_RUN ?? 'true';
  if (!['fake', 'real'].includes(mode) || !['true', 'false'].includes(dry))
    throw new Error('CONNECTORS ou DRY_RUN invalido');
  return { mode: mode as 'fake' | 'real', dryRun: dry === 'true' || mode === 'fake' };
}

export async function startRuntime(
  options: AppOptions & {
    boss: BossClient;
    connectors: RuntimeConnectors;
    dryRun: boolean;
    destination: string;
    heartbeatUrl?: string;
    now?: () => number;
    random?: () => number;
  },
) {
  if (!options.destination.trim()) throw new Error('DESTINATION_ID obrigatorio');
  const { db, connectors } = options;
  const now = options.now ?? Date.now;
  const queue = createQueueStore(db, options.dryRun);
  const push = createPushService(db, `mailto:${options.ownerEmail}`, options.dryRun);
  const app = await buildApp({ ...options, push });
  let stopped = false,
    active: Promise<void> | undefined;
  const publisher: Publisher = options.dryRun
    ? {
        async send(message) {
          // A confirmacao persiste a simulacao; nenhum publicador externo e chamado.
          return { status: 'enviado', mensagemId: `simulado:${message.idempotencyKey}`, simulado: true };
        },
      }
    : connectors.publisher;
  const accepting = new Set<Promise<void>>();
  const persist = async (message: IncomingMessage) => {
    if (
      !message.externalId.trim() ||
      !message.text.trim() ||
      message.text.length > 100000 ||
      !Number.isFinite(message.publishedAt) ||
      (message.advertisedPriceCents != null &&
        (!Number.isSafeInteger(message.advertisedPriceCents) || message.advertisedPriceCents <= 0))
    )
      throw new Error('mensagem de origem invalida');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const row = (
        await client.query(
          `INSERT INTO mensagens_brutas(fonte_id,mensagem_externa_id,conteudo,publicada_em,recebida_em,preco_anunciado_centavos)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (fonte_id,mensagem_externa_id) DO NOTHING RETURNING id`,
          [
            message.sourceId,
            message.externalId,
            JSON.stringify({ texto: message.text, link: message.link ?? null }),
            new Date(message.publishedAt),
            new Date(now()),
            message.advertisedPriceCents ?? null,
          ],
        )
      ).rows[0];
      if (row)
        await client.query('INSERT INTO ingestao_pendente(mensagem_bruta_id,destino_id,tentar_em) VALUES ($1,$2,$3)', [
          row.id,
          options.destination,
          new Date(now()),
        ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
  const accept = (message: IncomingMessage) => {
    if (stopped) return Promise.reject(new Error('ingestao encerrada'));
    const pending = persist(message);
    accepting.add(pending);
    void pending.then(
      () => accepting.delete(pending),
      () => accepting.delete(pending),
    );
    return pending;
  };
  const processPending = async () => {
    const client = await db.connect();
    let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(347894) AS acquired')).rows[0].acquired;
      if (!locked) return;
      const rows = (
        await db.query(
          `SELECT m.*,p.destino_id,f.ativa,f.autorizada_em FROM ingestao_pendente p
        JOIN mensagens_brutas m ON m.id=p.mensagem_bruta_id JOIN fontes f ON f.id=m.fonte_id
        WHERE NOT p.concluida AND p.tentar_em <= $1 AND p.destino_id=$2 ORDER BY m.recebida_em DESC LIMIT 20`,
          [new Date(now()), options.destination],
        )
      ).rows;
      for (const m of rows) {
        if (stopped) break;
        const config = await loadPipelineConfig(db);
        // Sem configuracao, preservar a entrada ate o operador ajustar o painel.
        if (!config.tagAmazon || !config.nicho.palavras_chave.length) break;
        const input = {
          mensagemId: m.id,
          texto: m.conteudo.texto,
          fonte: { id: m.fonte_id, ativa: m.ativa, autorizada: m.autorizada_em !== null },
          publicadaEm: new Date(m.publicada_em).getTime(),
          recebidaEm: new Date(m.recebida_em).getTime(),
          precoFonteCentavos: m.preco_anunciado_centavos == null ? null : Number(m.preco_anunciado_centavos),
        };
        const out = await runPipeline(input, config, {
          ...createPipelineStore(db, m.destino_id),
          reader: connectors.reader,
          now,
          resolve: connectors.resolve ?? resolve,
          nicheGate,
          renderMessage,
          validateMessage,
        });
        if (out.resultado.status === 'PASSA') await queue.enqueue(input, config, out, m.destino_id, now());
        await db.query('UPDATE ingestao_pendente SET concluida=$2,tentar_em=$3 WHERE mensagem_bruta_id=$1', [
          m.id,
          out.resultado.status !== 'ADIA',
          new Date(out.resultado.status === 'ADIA' ? out.resultado.quando : now()),
        ]);
      }
      await push.notify();
    } finally {
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(347894)');
      } finally {
        client.release();
      }
    }
  };
  const tick = () => {
    if (stopped) return Promise.resolve();
    if (!active)
      active = processPending().finally(() => {
        active = undefined;
      });
    return active;
  };
  let worker: Awaited<ReturnType<typeof startQueueWorker>> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const heartbeat = startHeartbeat(options.heartbeatUrl ?? '', {
    check: async () => {
      await db.query('SELECT 1');
    },
    onError: () => app.log.warn('heartbeat indisponivel'),
  });
  let closing: Promise<void> | undefined;
  const stop = () =>
    (closing ??= (async () => {
      stopped = true;
      clearInterval(timer);
      heartbeat.stop();
      try {
        await connectors.source.stop();
      } finally {
        try {
          await Promise.allSettled([...accepting]);
          await active;
        } finally {
          try {
            await worker?.stop();
          } finally {
            await connectors.reader.close?.();
          }
        }
      }
    })());
  app.addHook('onClose', stop);
  try {
    worker = await startQueueWorker({
      boss: options.boss,
      db,
      reader: connectors.reader,
      publisher,
      simulated: options.dryRun,
      now,
      random: options.random,
      onError: () => app.log.error('worker indisponivel'),
    });
    await connectors.source.start(accept);
    timer = setInterval(() => {
      void tick().catch(() => app.log.error('ingestao indisponivel'));
    }, 1000);
    timer.unref();
  } catch (error) {
    await app.close();
    throw error;
  }
  return { app, accept, tick, stop: () => app.close(), publisher, reader: connectors.reader };
}
