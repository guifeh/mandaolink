import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';
test('resolver para antes do produto com tag de terceiro e nao faz clique', async () => {
  const calls: string[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    calls.push(url); assert.equal(init.redirect, 'manual'); assert.equal(init.credentials, 'omit');
    return new Response(null, { status: 302, headers: { location: 'https://www.amazon.com.br/dp/B012345678?tag=terceiro-20' } });
  };
  assert.equal((await resolve('https://amzn.to/example', fetcher as typeof fetch)).ok, true);
  assert.deepEqual(calls, ['https://amzn.to/example']);
  await resolve('https://www.amazon.com.br/dp/B012345678?tag=terceiro-20', fetcher as typeof fetch);
  assert.equal(calls.length, 1);
});
test('resolver recusa URLs inseguras, host alheio e tag sem ASIN sem requisitar', async () => {
  const fetcher = async () => { throw new Error('nao deve chamar'); };
  for (const url of ['file://www.amazon.com.br/dp/B012345678', 'https://amazon.com.br:8000/', 'https://user:pass@amzn.to/a', 'https://evil.test/', 'https://www.amazon.com.br/?tag=terceiro-20']) {
    assert.equal((await resolve(url, fetcher as typeof fetch)).ok, false);
  }
});
test('resolver limita em cinco requests e nao segue Location externo', async () => {
  let calls = 0;
  const loop = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://cutt.ly/loop' } }); };
  assert.equal((await resolve('https://cutt.ly/loop', loop as typeof fetch)).ok, false); assert.equal(calls, 5);
  calls = 0;
  const external = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); };
  assert.equal((await resolve('https://amzn.to/loop', external as typeof fetch)).ok, false); assert.equal(calls, 1);
});
test('amzn.to faz apenas um request autorizado e para no Location mesmo sem ASIN', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://bit.ly/outro' } }); };
  assert.equal((await resolve('https://amzn.to/terceiro', fetcher as typeof fetch)).ok, false);
  assert.equal(calls, 1);
});
