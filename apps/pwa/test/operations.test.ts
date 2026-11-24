import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairLink, statusText } from '../src/operations-model.js';
import { operations } from '../src/api/operations.js';

test('operacao tem status legivel, motivos e links internos de conserto', () => {
  assert.equal(statusText.vermelho, 'Operação interrompida');
  assert.equal(repairLink('whatsapp_desconectado'), '#pareamento');
  assert.equal(repairLink('tag_invalida'), '#afiliado');
  assert.equal(repairLink('limite'), '#horarios');
});

test('cliente operacional usa cookies, paginacao e pausa persistente; rejeita falhas', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response('{}', { status: 200 });
  };
  try {
    await operations.history(2);
    await operations.pause(true);
    assert.equal(calls[0].url, '/operacao/historico?pagina=2');
    assert.equal(calls[0].init?.credentials, 'include');
    assert.equal(calls[1].init?.method, 'PUT');
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { pausado: true });
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    await assert.rejects(operations.state(), /login/);
  } finally {
    globalThis.fetch = original;
  }
});
