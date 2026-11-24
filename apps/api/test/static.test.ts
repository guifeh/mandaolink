import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { servePwa, publicPwaPath } from '../src/static.js';
test('shell e SW publicos, endpoints operacionais privados na mesma origem', async () => {
  const app = await buildApp({ db: {} as Pool, ownerEmail: 'owner@example.test', appOrigin: 'http://localhost:3000' });
  await servePwa(app);
  try {
    assert.equal((await app.inject('/login')).statusCode, 200);
    assert.equal((await app.inject('/')).statusCode, 200);
    assert.equal((await app.inject('/sw.js')).statusCode, 200);
    assert.equal((await app.inject('/operacao')).statusCode, 401);
    for (const url of ['/fontes', '/ajuda', '/rota-desconhecida']) {
      const response = await app.inject({ url, headers: { accept: 'text/html' } });
      assert.equal(response.statusCode, 200, url);
      assert.match(response.headers['content-type'] ?? '', /text\/html/);
    }
    for (const url of ['/operacao', '/pendencias', '/config']) {
      assert.equal((await app.inject({ url, headers: { accept: 'text/html' } })).statusCode, 401, url);
    }
    assert.equal((await app.inject({ url: '/arquivo-ausente.js', headers: { accept: 'text/html' } })).statusCode, 401);
    assert.equal(publicPwaPath('/assets/../config'), false);
  } finally {
    await app.close();
  }
});
