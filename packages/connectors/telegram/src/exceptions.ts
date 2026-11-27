// Grava as exceções do conector na tabela excecoes, com tipo telegram_* e fonte resolvida
// por fontes.identificador_externo. O índice excecao_aberta_unica evita duplicar exceção aberta.
import type { ExceptionSink, TipoExcecao } from './types.ts';

type Queryable = { query(sql: string, params?: unknown[]): Promise<unknown> };

const tipoDb = (t: TipoExcecao) => `telegram_${t}`;

export function createPgExceptionSink(db: Queryable): ExceptionSink {
  return {
    async open(e) {
      await db.query(
        `INSERT INTO excecoes(tipo, descricao, severidade, fonte_id)
         VALUES ($1, $2, $3, (SELECT id FROM fontes WHERE plataforma='telegram' AND identificador_externo=$4))
         ON CONFLICT DO NOTHING`,
        [tipoDb(e.tipo), e.descricao, e.severidade, e.grupoExternoId ?? null],
      );
    },
    async resolve(tipo, grupoExternoId) {
      await db.query(
        `UPDATE excecoes SET resolvida_em=now()
         WHERE tipo=$1 AND resolvida_em IS NULL AND ($2::text IS NULL OR fonte_id IS NOT DISTINCT FROM
           (SELECT id FROM fontes WHERE plataforma='telegram' AND identificador_externo=$2))`,
        [tipoDb(tipo), grupoExternoId ?? null],
      );
    },
  };
}
