// Leitor via conta de usuário (MTProto/GramJS) para canais públicos que não adicionam bot.
// Só leitura e só por eventos: assina mensagens novas dos canais da allowlist. Nunca busca histórico
// (o MtClient nem expõe isso) e nunca envia.
import { backoffMs, createLifecycle, DISCONNECT_ALERT_MS, readAllowlist } from './shared.ts';
import type { Allowlist, ExceptionSink, TelegramSource } from './types.ts';

export type MtMessage = { chatId: string; id: number; text: string; date: number };
export type MtConnection = 'connected' | 'disconnected' | 'broken';

/** Parte do cliente MTProto que o leitor usa. O adapter GramJS (gramjs.ts) implementa. */
export interface MtClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Assina mensagens novas SÓ destes chats (ids marcados). */
  onNewMessage(chats: string[], handler: (m: MtMessage) => void): void;
  onConnectionChange(handler: (s: MtConnection) => void): void;
}

const FATAL: { re: RegExp; tipo: 'sessao_invalidada' | 'numero_bloqueado'; descricao: string }[] = [
  {
    re: /USER_DEACTIVATED_BAN|PHONE_NUMBER_BANNED/,
    tipo: 'numero_bloqueado',
    descricao: 'A conta de leitura do Telegram foi banida. Use outro número para a conta de leitura.',
  },
  {
    re: /AUTH_KEY_UNREGISTERED|AUTH_KEY_DUPLICATED|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/,
    tipo: 'sessao_invalidada',
    descricao: 'A sessão da conta de leitura do Telegram foi encerrada: é preciso entrar de novo.',
  },
];

export function classifyMtprotoError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return FATAL.find((f) => f.re.test(msg)) ?? null;
}

const MARKED_ID = /^-?\d{5,20}$/;

export type MtprotoSourceOptions = {
  client: MtClient;
  /** Ids marcados dos canais autorizados (ex.: "-1001234567890"). Username não é aceito. */
  canais: Allowlist;
  exceptions: ExceptionSink;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onError?: (e: unknown) => void;
  disconnectAlertMs?: number;
};

export function createMtprotoSource(o: MtprotoSourceOptions): TelegramSource {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = o.random ?? Math.random;
  const onError = o.onError ?? (() => {});
  const life = createLifecycle({
    exceptions: o.exceptions,
    onError,
    alertAfterMs: o.disconnectAlertMs ?? DISCONNECT_ALERT_MS,
    fonte: 'conta',
  });
  let running = false;
  let subscribed = false;

  async function connectWithRetry() {
    for (let attempt = 0; running; attempt++) {
      try {
        await o.client.connect();
        life.connected();
        return;
      } catch (e) {
        const fatal = classifyMtprotoError(e);
        if (fatal) {
          life.fatal(fatal.tipo, fatal.descricao);
          running = false;
          return;
        }
        onError(e);
        life.dropped();
        await sleep(backoffMs(attempt, random));
      }
    }
  }

  return {
    async start() {
      if (running) return;
      const allow = await readAllowlist(o.canais);
      // Filtro vazio no GramJS = TODOS os chats. Sem fonte autorizada, não assina nada.
      if (!allow.size) throw new Error('sem_canais_autorizados');
      const invalid = [...allow].filter((c) => !MARKED_ID.test(c));
      if (invalid.length) throw new Error(`canal deve ser id numérico marcado: ${invalid.join(', ')}`);
      running = true;
      life.set('conectando');
      if (!subscribed) {
        subscribed = true;
        o.client.onConnectionChange((s) => {
          if (!running) return;
          if (s === 'connected') life.connected();
          else life.dropped();
        });
        o.client.onNewMessage([...allow], (m) => {
          // Segunda checagem: a allowlist pode ter mudado no banco desde a assinatura.
          void readAllowlist(o.canais)
            .then((now) => {
              if (!running || !now.has(m.chatId) || !m.text) return;
              life.emit({
                plataforma: 'telegram',
                grupoExternoId: m.chatId,
                mensagemExternaId: String(m.id),
                texto: m.text,
                publicadaEm: m.date * 1000,
              });
            })
            .catch(onError);
        });
      }
      await connectWithRetry();
    },
    async stop() {
      running = false;
      life.stopped();
      await o.client.disconnect().catch(onError);
    },
    onMessage: (h) => life.onMessage(h),
    status: () => life.status(),
  };
}
