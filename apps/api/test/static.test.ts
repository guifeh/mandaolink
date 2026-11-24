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
    assert.equal(publicPwaPath('/assets/../config'), false);
  } finally { await app.close(); }
});
