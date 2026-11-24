import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { migrate } from '../src/migrate.js';
import { runtimeFlags, startRuntime } from '../src/runtime.js';
import { createFakeConnectors } from '../src/fake-connectors.js';
import type { BossClient } from '../src/queue-worker.js';

test('flags falham fechadas e fake permanece simulado mesmo com DRY_RUN=false', () => {
  assert.deepEqual(runtimeFlags({}), { mode: 'fake', dryRun: true });
  assert.equal(runtimeFlags({ CONNECTORS: 'fake', DRY_RUN: 'false' }).dryRun, true);
  assert.equal(runtimeFlags({ CONNECTORS: 'real' }).dryRun, true);
  assert.throws(() => runtimeFlags({ DRY_RUN: 'yes' }));
});

test('bootstrap fake persiste entrada, G0-G9 e envio simulado; restart nao duplica e stop preserva fila', async () => {
  const embedded = new PGlite();
  const client = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }], rowCount: 1 };
      if (sql.includes('pg_advisory_')) return { rows: [], rowCount: 1 };
      if (!params && sql.includes('\n') && /^(CREATE|ALTER)/.test(sql)) {
        await embedded.exec(sql);
        return { rows: [], rowCount: 0 };
      }
      const result = await embedded.query(sql, params);
      return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
    },
    release() {},
  };
  const db = { query: client.query, connect: async () => client } as unknown as Pool;
  let dispatch = async () => {};
  let bossStopped = false,
    sourceStopped = false,
    readerClosed = false,
    realCalls = 0;
  const boss = {
    on() {},
    off() {},
    async start() {},
    async stop() {
      bossStopped = true;
    },
    async createQueue() {},
    async send() {
      return 'job';
    },
    async work(_name: string, _options: unknown, callback: () => Promise<void>) {
      dispatch = callback;
    },
  } as unknown as BossClient;
  let now = Date.parse('2026-11-23T15:00:00Z');
  await migrate(db);
  await db.query(
    "UPDATE config_nicho SET pausado=false,tag_amazon='cliente-20',palavras_chave=ARRAY['carro','veicular','automotivo']",
  );
  const connectors = await createFakeConnectors(db, () => now);
  const originalStop = connectors.source.stop;
  connectors.source.stop = async () => {
    sourceStopped = true;
    await originalStop();
  };
  connectors.reader.close = async () => {
    readerClosed = true;
  };
  connectors.publisher.send = async () => {
    realCalls++;
    throw new Error('publicador externo proibido');
  };
  const runtime = await startRuntime({
    db,
    boss,
    connectors,
    dryRun: true,
    destination: 'fake:destino',
    now: () => now,
    random: () => 0,
    ownerEmail: 'owner@example.test',
    appOrigin: 'http://localhost:3000',
  });
  try {
    assert.equal((await runtime.app.inject('/saude')).statusCode, 200);
    assert.equal(runtime.reader, connectors.reader);
    for (let i = 0; i < 3; i++) await runtime.tick();
    const total = Number((await db.query('SELECT count(*) AS n FROM mensagens_brutas')).rows[0].n);
    assert.equal(total, 45);
    await dispatch();
    const sent = (await db.query("SELECT * FROM envios WHERE estado='enviado'")).rows;
    assert.equal(sent.length, 1);
    assert.equal(sent[0].simulado, true);
    assert.match(sent[0].mensagem_externa_id, /^simulado:/);
    assert.equal(realCalls, 0);
    const events = (
      await db.query('SELECT gate,motivo,simulado FROM eventos_oferta WHERE mensagem_bruta_id=$1 ORDER BY id', [
        sent[0].mensagem_bruta_id,
      ])
    ).rows;
    for (let gate = 0; gate <= 9; gate++) assert.ok(events.some((e) => e.gate === gate));
    assert.ok(events.some((e) => e.simulado && e.motivo === 'envio_simulado'));
    await createFakeConnectors(db, () => now).then((c) => c.source.start(runtime.accept));
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM mensagens_brutas')).rows[0].n), total);
    const queued = Number((await db.query("SELECT count(*) AS n FROM envios WHERE estado='na_fila'")).rows[0].n);
    assert.ok(queued > 0);
    const sourceId = (await db.query('SELECT id FROM fontes LIMIT 1')).rows[0].id;
    const accepting = runtime.accept({
      sourceId,
      externalId: 'shutdown-race',
      text: 'Entrada sintetica durante encerramento',
      publishedAt: now,
    });
    now += 1000;
    await runtime.stop();
    await accepting;
    await runtime.stop();
    assert.equal(
      (await db.query("SELECT 1 FROM mensagens_brutas WHERE mensagem_externa_id='shutdown-race'")).rowCount,
      1,
    );
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM envios WHERE estado='na_fila'")).rows[0].n), queued);
    assert.ok(sourceStopped && readerClosed && bossStopped);
    await assert.rejects(
      runtime.accept({ sourceId: 'fake', externalId: 'after-stop', text: 'teste', publishedAt: now }),
      /encerrada/,
    );
  } finally {
    await runtime.stop();
    await embedded.close();
  }
});
