import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { connectDatabase } from '../src/db.js';

const embedded = process.env.TEST_DATABASE_URL ? undefined : new PGlite();
const localClient = {
  async query(sql: string, params?: unknown[]) {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }], rowCount: 1 };
    if (sql.includes('pg_advisory_')) return { rows: [], rowCount: 1 };
    if (!params && sql.includes('\n') && /^(CREATE|ALTER)/.test(sql)) {
      await embedded!.exec(sql);
      return { rows: [], rowCount: 0 };
    }
    const result = await embedded!.query(sql, params);
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
  },
  release() {},
};
const db = process.env.TEST_DATABASE_URL
  ? connectDatabase(process.env.TEST_DATABASE_URL)
  : ({
      query: localClient.query,
      connect: async () => localClient,
    } as unknown as Pool);

let capturedLink = '';
const app = await buildApp({
  db,
  ownerEmail: 'owner@example.test',
  appOrigin: 'http://localhost:3000',
  cookieSecure: false,
  sendMagicLink: async (_email, link) => {
    capturedLink = link;
  },
});

let sessionCookie = '';

before(async () => {
  await migrate(db);

  // Autenticação para testes
  await app.inject({ method: 'POST', url: '/auth/link', payload: { email: 'owner@example.test' } });
  const token = capturedLink.split('#token=')[1];
  const authRes = await app.inject({ method: 'POST', url: '/auth/verificar', payload: { token } });
  const cookieHeader = authRes.headers['set-cookie'];
  sessionCookie = Array.isArray(cookieHeader) ? cookieHeader[0] : (cookieHeader as string);
});

after(async () => {
  await app.close();
  if (embedded) await embedded.close();
  else await db.end();
});

test('GET /resumo exige autenticacao', async () => {
  const unauthRes = await app.inject({ method: 'GET', url: '/resumo' });
  assert.equal(unauthRes.statusCode, 401);
});

test('GET /resumo retorna resumo do dia com formato legivel', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/resumo?data=2026-11-23',
    headers: {
      cookie: sessionCookie,
    },
  });

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);

  assert.equal(body.data, '2026-11-23');
  assert.ok(typeof body.texto === 'string');
  assert.ok(body.texto.includes('Resumo MandaoLink — 23/11/2026'));
  assert.ok(body.dados !== undefined);
  assert.equal(typeof body.dados.enviadas, 'number');
  assert.equal(typeof body.dados.descartadas, 'number');
});
