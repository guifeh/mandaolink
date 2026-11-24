import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { g0, g3, g4, g7, g9, type PipelineInput, type PipelineConfig, type PipelineOutcome, type QueueItem, type QueueStore } from '@mandaolink/core';
import { loadLastSend, loadPipelineConfig } from './pipeline-store.js';

export function createQueueStore(db: Pool, simulated = false): QueueStore & {
  enqueue(input: PipelineInput, config: PipelineConfig, outcome: PipelineOutcome, destination: string, now: number): Promise<string | null>;
} {
  return {
    async lock<T>(work: () => Promise<T>) {
      const client = await db.connect();
      let acquired = false;
      try {
        acquired = (await client.query('SELECT pg_try_advisory_lock(347892) AS acquired')).rows[0].acquired;
        return acquired ? await work() : null;
      } finally { try { if (acquired) await client.query('SELECT pg_advisory_unlock(347892)'); } finally { client.release(); } }
    },
    async enqueue(input, config, outcome, destination, now) {
      if (outcome.resultado.status !== 'PASSA' || outcome.gate !== 8 || !outcome.asin || !outcome.produto || !outcome.mensagem || !outcome.link || !destination.trim()) throw new Error('oferta nao aprovada');
      if (g0({ ...input.fonte, publicadaEm: input.publicadaEm }, now, config.idadeMaximaMs).status !== 'PASSA' ||
          g4({ ok: true, product: outcome.produto }, outcome.asin, now, config.reverAposMs).status !== 'PASSA' ||
          g7(outcome.asin, config.tagAmazon, outcome.link).status !== 'PASSA') throw new Error('oferta invalida');
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(347893)');
        const last = await loadLastSend(client, destination, outcome.asin);
        if (g3(last, now, { janelaMs: config.janelaDedupMs, quedaPercentual: config.quedaPercentual, precoAtualCentavos: outcome.produto.priceCents }).status !== 'PASSA') {
          await client.query('COMMIT'); return null;
        }
        const offer = (await client.query("SELECT id FROM ofertas WHERE loja='amazon' AND id_loja=$1", [outcome.asin])).rows[0];
        if (!offer) throw new Error('oferta sem evento persistido');
        const key = createHash('sha256').update(JSON.stringify(['amazon', outcome.asin, destination, input.mensagemId])).digest('hex');
        const p = outcome.produto;
        const row = (await client.query(`INSERT INTO envios(oferta_id,mensagem_bruta_id,destino_id,chave_idempotencia,texto,texto_hash,
          criado_em,expira_em,preco_centavos,preco_lido_em,imagem_url,produto_snapshot,simulado)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING id`,
          [offer.id, input.mensagemId, destination, key, outcome.mensagem.texto, createHash('sha256').update(outcome.mensagem.texto).digest('hex'),
            new Date(now), new Date(Math.min(input.recebidaEm, now) + (config.ttlMs ?? 2 * 3600000)), p.priceCents, p.checkedAt, p.image, JSON.stringify(p), simulated])).rows[0];
        await client.query('COMMIT'); return row?.id ?? null;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async expire(now) {
      await db.query(`WITH expired AS (
        UPDATE envios SET estado='descartado',motivo_descarte='vencida_na_fila' WHERE estado='na_fila' AND expira_em < $1 RETURNING oferta_id,mensagem_bruta_id
      ) INSERT INTO eventos_oferta(oferta_id,mensagem_bruta_id,gate,resultado,motivo,criado_em)
        SELECT oferta_id,mensagem_bruta_id,9,'REPROVA','vencida na fila',$1 FROM expired`, [new Date(now)]);
    },
    async state(now) {
      const row = (await db.query(`SELECT c.*, f.proximo_envio_em,
        (SELECT count(*)::int FROM envios WHERE tentado_em > $1::timestamptz-interval '1 hour' AND tentado_em <= $1) AS hora,
        (SELECT count(*)::int FROM envios WHERE (tentado_em AT TIME ZONE 'America/Sao_Paulo')::date=($1::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date AND tentado_em <= $1) AS dia
        FROM config_nicho c CROSS JOIN controle_fila f WHERE c.id=1 AND f.id=1`, [new Date(now)])).rows[0];
      if (!row) throw new Error('configuracao de fila ausente');
      return { pausado: row.pausado, limiteHora: row.limite_hora, limiteDia: row.limite_dia, horarioInicio: row.horario_inicio, horarioFim: row.horario_fim,
        fuso: row.fuso_horario, contagemHora: row.hora, contagemDia: row.dia, proximoEm: new Date(row.proximo_envio_em).getTime() };
    },
    async next(now) {
      const row = (await db.query(`SELECT e.*,o.id_loja,m.fonte_id,m.conteudo,m.publicada_em,m.recebida_em,m.preco_anunciado_centavos,f.ativa,f.autorizada_em
        FROM envios e JOIN ofertas o ON o.id=e.oferta_id JOIN mensagens_brutas m ON m.id=e.mensagem_bruta_id JOIN fontes f ON f.id=m.fonte_id
        WHERE e.estado='na_fila' AND e.simulado=$2 AND e.nao_antes_em <= $1 ORDER BY e.criado_em DESC,e.id DESC LIMIT 1`, [new Date(now), simulated])).rows[0];
      if (!row) return null;
      return { id: row.id, destinoId: row.destino_id, idempotencyKey: row.chave_idempotencia, asin: row.id_loja, enfileiradaEm: new Date(row.criado_em).getTime(),
        config: await loadPipelineConfig(db), produto: row.produto_snapshot,
        input: { mensagemId: row.mensagem_bruta_id, texto: row.conteudo.texto ?? '', fonte: { id: row.fonte_id, ativa: row.ativa, autorizada: row.autorizada_em !== null },
          publicadaEm: new Date(row.publicada_em).getTime(), recebidaEm: new Date(row.recebida_em).getTime(), precoFonteCentavos: row.preco_anunciado_centavos === null ? null : Number(row.preco_anunciado_centavos) } };
    },
    async discard(id, reason) {
      await db.query(`WITH discarded AS (UPDATE envios SET estado='descartado',motivo_descarte=$2 WHERE id=$1 AND estado='na_fila' RETURNING oferta_id,mensagem_bruta_id)
        INSERT INTO eventos_oferta(oferta_id,mensagem_bruta_id,gate,resultado,motivo) SELECT oferta_id,mensagem_bruta_id,9,'REPROVA',$2 FROM discarded`, [id, reason]);
    },
    async defer(id, when) { await db.query("UPDATE envios SET nao_antes_em=$2 WHERE id=$1 AND estado='na_fila'", [id, new Date(when)]); },
    async claim(item, outcome, now, next) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        if (g9(item.input.recebidaEm, item.enfileiradaEm, now, item.config.ttlMs).status !== 'PASSA') { await client.query('COMMIT'); return false; }
        const p = outcome.produto!;
        const row = await client.query(`UPDATE envios SET estado='incerto',incerto_em=$2,tentado_em=$2,texto=$3,texto_hash=$4,
          preco_centavos=$5,preco_lido_em=$6,imagem_url=$7,produto_snapshot=$8
          WHERE id=$1 AND estado='na_fila' AND expira_em >= $2 AND NOT (SELECT pausado FROM config_nicho WHERE id=1)
          AND EXISTS(SELECT 1 FROM mensagens_brutas m JOIN fontes f ON f.id=m.fonte_id WHERE m.id=envios.mensagem_bruta_id AND f.ativa AND f.autorizada_em IS NOT NULL)
          RETURNING id`, [item.id, new Date(now), outcome.mensagem!.texto, createHash('sha256').update(outcome.mensagem!.texto).digest('hex'), p.priceCents, p.checkedAt, p.image, JSON.stringify(p)]);
        if (row.rowCount) await client.query('UPDATE controle_fila SET proximo_envio_em=$1 WHERE id=1', [new Date(next)]);
        await client.query('COMMIT'); return !!row.rowCount;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async confirmed(id, externalId, now, simulated = false) {
      const row = await db.query(`WITH confirmed AS (
        UPDATE envios SET estado='enviado',mensagem_externa_id=COALESCE(mensagem_externa_id,$2),enviado_em=COALESCE(enviado_em,$3),erro=NULL,simulado=$4
        WHERE id=$1 AND (estado='incerto' OR (estado='enviado' AND simulado=$4)) RETURNING *
      ) INSERT INTO eventos_oferta(oferta_id,mensagem_bruta_id,envio_id,gate,resultado,motivo,simulado)
        SELECT oferta_id,mensagem_bruta_id,id,9,'PASSA',CASE WHEN $4 THEN 'envio_simulado' ELSE 'envio_confirmado' END,$4 FROM confirmed RETURNING id`, [id, externalId, new Date(now), simulated]);
      if (!row.rowCount) throw new Error('reserva de envio ausente');
    },
    async uncertain(id, reason) { await db.query("UPDATE envios SET erro=$2 WHERE id=$1 AND estado='incerto'", [id, reason]); },
    async notTransmitted(id, reason) {
      if (!reason.trim()) throw new Error('prova pre-transmissao obrigatoria');
      await db.query(`WITH failed AS (
        UPDATE envios SET estado='falhou',falha_pre_transmissao=true,erro=$2 WHERE id=$1 AND estado='incerto' AND mensagem_externa_id IS NULL RETURNING oferta_id,mensagem_bruta_id
      ) INSERT INTO eventos_oferta(oferta_id,mensagem_bruta_id,gate,resultado,motivo,prova_pre_transmissao,envio_id)
        SELECT oferta_id,mensagem_bruta_id,9,'REPROVA','falha_pre_transmissao',$3,$1 FROM failed`, [id, reason, JSON.stringify({ naoTransmitido: true, motivo: reason })]);
    }
  };
}
