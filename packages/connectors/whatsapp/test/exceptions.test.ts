// Grava exceções num Postgres embutido (PGlite) com as migrações reais do repositório.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPgExceptionSink } from '../src/exceptions.ts';

const FONTE = '120363000000000002@g.us';

async function db() {
  const pg = new PGlite();
  const dir = new URL('../../../../db/migrations/', import.meta.url);
  for (const f of (await readdir(dir)).filter((n) => /^\d+.*\.sql$/.test(n)).sort())
    await pg.exec(await readFile(new URL(f, dir), 'utf8'));
  await pg.query(
    `INSERT INTO fontes(plataforma, identificador_externo, nome, ativa, autorizada_em) VALUES ('whatsapp', $1, 'Fonte exemplo', true, now())`,
    [FONTE],
  );
  return pg;
}
const abertas = async (pg: PGlite) =>
  (
    await pg.query<{ tipo: string; fonte: boolean }>(
      `SELECT tipo, fonte_id IS NOT NULL AS fonte FROM excecoes WHERE resolvida_em IS NULL ORDER BY tipo`,
    )
  ).rows;

test('abre uma exceção por (tipo, fonte), sem duplicar, e resolve', async () => {
  const pg = await db();
  const s = createPgExceptionSink(pg);
  for (let i = 0; i < 3; i++) await s.open({ tipo: 'desconectado', descricao: 'x', severidade: 'vermelho' });
  await s.open({ tipo: 'removido_do_grupo', descricao: 'x', severidade: 'amarelo', grupoExternoId: FONTE });
  await s.open({ tipo: 'removido_do_grupo', descricao: 'x', severidade: 'amarelo', grupoExternoId: FONTE });
  assert.deepEqual(await abertas(pg), [
    { tipo: 'whatsapp_desconectado', fonte: false },
    { tipo: 'whatsapp_removido_do_grupo', fonte: true },
  ]);
  await s.resolve('desconectado');
  await s.resolve('removido_do_grupo', FONTE);
  assert.deepEqual(await abertas(pg), []);
  await s.open({ tipo: 'desconectado', descricao: 'x', severidade: 'vermelho' });
  assert.equal((await abertas(pg)).length, 1, 'reabre depois de resolvida');
});
