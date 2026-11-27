// Exceções do Telegram num Postgres embutido (PGlite) com as migrações reais do repositório.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPgExceptionSink } from '../src/exceptions.ts';

const FONTE = '-1001111111111';

test('telegram_*: uma exceção aberta por (tipo, fonte), resolve e reabre', async () => {
  const pg = new PGlite();
  const dir = new URL('../../../../db/migrations/', import.meta.url);
  for (const f of (await readdir(dir)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await pg.exec(await readFile(new URL(f, dir), 'utf8'));
  await pg.query(
    `INSERT INTO fontes(plataforma, identificador_externo, nome, ativa, autorizada_em) VALUES ('telegram', $1, 'Canal exemplo', true, now())`,
    [FONTE],
  );
  const abertas = async () =>
    (
      await pg.query<{ tipo: string; fonte: boolean }>(
        `SELECT tipo, fonte_id IS NOT NULL AS fonte FROM excecoes WHERE resolvida_em IS NULL ORDER BY tipo`,
      )
    ).rows;
  const s = createPgExceptionSink(pg);
  for (let i = 0; i < 2; i++) await s.open({ tipo: 'desconectado', descricao: 'x', severidade: 'vermelho' });
  await s.open({ tipo: 'removido_do_grupo', descricao: 'x', severidade: 'amarelo', grupoExternoId: FONTE });
  assert.deepEqual(await abertas(), [
    { tipo: 'telegram_desconectado', fonte: false },
    { tipo: 'telegram_removido_do_grupo', fonte: true },
  ]);
  await s.resolve('removido_do_grupo', FONTE);
  await s.resolve('desconectado');
  assert.deepEqual(await abertas(), []);
  await s.open({ tipo: 'desconectado', descricao: 'x', severidade: 'vermelho' });
  assert.equal((await abertas()).length, 1);
});
