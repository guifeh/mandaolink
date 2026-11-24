import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHeartbeat } from '../src/heartbeat.js';
test('heartbeat vazio desligado; configurado roda a cada5min e fecha o timer', async () => {
  let scheduled = 0,
    calls = 0,
    stopped = false;
  let tick: () => Promise<void> = async () => {};
  const options = {
    fetchImpl: (async () => {
      calls++;
      return new Response('ok');
    }) as typeof fetch,
    schedule: (fn: () => Promise<void>, ms: number) => {
      scheduled++;
      tick = fn;
      assert.equal(ms, 300000);
      return () => {
        stopped = true;
      };
    },
  };
  const off = startHeartbeat('', options);
  assert.equal(scheduled, 0);
  off.stop();
  const heartbeat = startHeartbeat('https://monitor.example.test/ping/synthetic', options);
  assert.equal(calls, 0);
  assert.equal(scheduled, 1);
  await tick();
  assert.equal(calls, 1);
  heartbeat.stop();
  assert.equal(stopped, true);
  await tick();
  assert.equal(calls, 1);
});
test('heartbeat nao sobrepoe requests e nao pinga se banco indisponivel', async () => {
  let tick: () => Promise<void> = async () => {},
    calls = 0;
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const heartbeat = startHeartbeat('https://monitor.example.test/ping/synthetic', {
    fetchImpl: async () => {
      calls++;
      await pending;
      return new Response('ok');
    },
    schedule: (fn) => {
      tick = fn;
      return () => {};
    },
  });
  const first = tick();
  await tick();
  assert.equal(calls, 1);
  release();
  await first;
  heartbeat.stop();
  let errors = 0;
  const unavailable = startHeartbeat('https://monitor.example.test/ping/synthetic', {
    check: async () => {
      throw new Error('banco fora');
    },
    onError: () => {
      errors++;
    },
    fetchImpl: async () => {
      calls++;
      return new Response('ok');
    },
    schedule: (fn) => {
      tick = fn;
      return () => {};
    },
  });
  await tick();
  assert.equal(calls, 1);
  assert.equal(errors, 1);
  unavailable.stop();
});
