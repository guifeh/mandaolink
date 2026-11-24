import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { createPushService, validSubscription } from '../src/push.js';

test('push persiste chaves, ensaio nao envia; entrega deduplica e remove assinatura expirada', async () => {
  const embedded = new PGlite();
  await embedded.exec(
    'CREATE TABLE excecoes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),criada_em timestamptz DEFAULT now(),resolvida_em timestamptz)',
  );
  await embedded.exec(await readFile(new URL('../../../db/migrations/006_push.sql', import.meta.url), 'utf8'));
  const db = {
    async query(sql: string, params?: unknown[]) {
      const r = await embedded.query(sql, params);
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    },
  } as unknown as Pool;
  let calls = 0;
  const send = (async () => {
    calls++;
    return {};
  }) as Parameters<typeof createPushService>[3];
  const service = createPushService(db, 'mailto:owner@example.test', false, send);
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic',
    keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
  };
  try {
    assert.equal(validSubscription(sub), true);
    assert.equal(validSubscription({ ...sub, endpoint: 'https://127.0.0.1/private' }), false);
    assert.equal(validSubscription({ ...sub, endpoint: 'https://fcm.googleapis.com.evil.test/x' }), false);
    assert.equal((await service.config()).publicKey, (await service.config()).publicKey);
    await service.subscribe(sub);
    await db.query("INSERT INTO excecoes(criada_em) VALUES (now()+interval '1 second')");
    await createPushService(db, 'mailto:owner@example.test', true, send).notify();
    assert.equal(calls, 0);
    await service.notify();
    await service.notify();
    assert.equal(calls, 1);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM push_entregas')).rows[0].n), 1);
    await db.query("INSERT INTO excecoes(criada_em) VALUES (now()+interval '2 seconds')");
    const expired = createPushService(db, 'mailto:owner@example.test', false, async () => {
      throw { statusCode: 410 };
    });
    await expired.notify();
    assert.equal((await db.query('SELECT * FROM push_subscriptions')).rowCount, 0);
  } finally {
    await embedded.close();
  }
});
