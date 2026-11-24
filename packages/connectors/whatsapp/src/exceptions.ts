// Grava as exceções do conector na tabela excecoes (migrações 001–002).
// O índice único parcial excecao_aberta_unica garante 1 exceção aberta por (tipo, fonte).
import type { ExceptionSink, TipoExcecao } from './types.ts';

type Queryable = { query(sql: string, params?: unknown[]): Promise<unknown> };

const fonteId = `(SELECT id FROM fontes WHERE plataforma='whatsapp' AND identificador_externo=$GRUPO)`;
const tipoDb = (t: TipoExcecao) => `whatsapp_${t}`;

export function createPgExceptionSink(db: Queryable): ExceptionSink {
  return {
    async open(e) {
      await db.query(
        `INSERT INTO excecoes(tipo, descricao, severidade, fonte_id)
         VALUES ($1, $2, $3, ${fonteId.replace('$GRUPO', '$4')}) ON CONFLICT DO NOTHING`,
        [tipoDb(e.tipo), e.descricao, e.severidade, e.grupoExternoId ?? null],
      );
    },
    async resolve(tipo, grupoExternoId) {
      await db.query(
        `UPDATE excecoes SET resolvida_em=now()
         WHERE tipo=$1 AND resolvida_em IS NULL AND ($2::text IS NULL OR fonte_id IS NOT DISTINCT FROM ${fonteId.replace('$GRUPO', '$2')})`,
        [tipoDb(tipo), grupoExternoId ?? null],
      );
    },
  };
}
