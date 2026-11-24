import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { startQueueWorker, type BossClient } from '../src/queue-worker.js';
test('worker pg-boss registra fila serial e para sem tocar publicador real', async () => {
  const calls: string[] = [];
  let options: unknown, workOptions: unknown;
  const boss = {
    on: () => {
      calls.push('on');
    },
    off: () => {
      calls.push('off');
    },
    start: async () => {
      calls.push('start');
    },
    stop: async () => {
      calls.push('stop');
    },
    createQueue: async (_name: string, opts: unknown) => {
      options = opts;
    },
    work: async (_name: string, opts: unknown) => {
      workOptions = opts;
    },
    send: async (_name: string, _data: unknown, opts: { singletonKey: string; startAfter: Date }) => {
      calls.push('wake');
      assert.equal(opts.singletonKey, 'global');
      assert.equal(opts.startAfter.getTime(), 1000);
      return 'id';
    },
  } as unknown as BossClient;
  const worker = await startQueueWorker({
    boss,
    db: {} as Pool,
    now: () => 0,
    reader: {
      read: async () => {
        throw new Error('nao deve ler');
      },
    },
    publisher: {
      send: async () => {
        throw new Error('nao deve publicar');
      },
    },
    onError: () => {},
  });
  assert.deepEqual(options, { policy: 'stately', retryLimit: 3, retryDelay: 5, expireInSeconds: 60 });
  assert.deepEqual(workOptions, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 1 });
  await worker.stop();
  assert.deepEqual(calls, ['on', 'start', 'wake', 'stop', 'off']);
});
