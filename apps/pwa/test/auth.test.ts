import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSession } from '../src/auth.js';

test('link magico remove token da URL, consome uma vez mesmo com chamadas simultaneas', async () => {
  const previousWindow = globalThis.window,
    previousFetch = globalThis.fetch;
  const token = 'a'.repeat(64),
    calls: string[] = [];
  let removed = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hash: `#token=${token}` },
      history: {
        replaceState(_data: unknown, _unused: string, url: string) {
          assert.equal(url, '/');
          removed = true;
        },
      },
    },
  });
  globalThis.fetch = async (url, init) => {
    assert.equal(removed, true);
    calls.push(String(url));
    if (url === '/auth/verificar') {
      assert.equal(init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(init?.body)), { token });
    }
    return new Response('{}', { status: 200 });
  };
  try {
    assert.deepEqual(await Promise.all([loadSession(), loadSession()]), [true, true]);
    assert.deepEqual(calls, ['/auth/verificar', '/config']);
  } finally {
    globalThis.fetch = previousFetch;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});
