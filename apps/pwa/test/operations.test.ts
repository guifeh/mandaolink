import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repairLink, statusText } from '../src/operations-model.js';
import { operations } from '../src/api/operations.js';
import { getTabFromHash } from '../src/App.js';

test('operacao tem status legivel, motivos e links internos de conserto', () => {
  assert.equal(statusText.vermelho, 'Operação interrompida');
  assert.equal(repairLink('whatsapp_desconectado'), '/#pareamento');
  assert.equal(repairLink('tag_invalida'), '/#afiliado');
  assert.equal(repairLink('limite'), '/#horarios');
});

test('cada tipo de pendencia leva a uma rota de conserto existente, inclusive tipos novos', () => {
  const cases = [
    ['fonte_perdida', null, '/fontes', 'fontes'],
    ['whatsapp_removido_do_grupo', 'fonte-exemplo', '/fontes', 'fontes'],
    ['whatsapp_removido_do_grupo', null, '/ajuda#grupo-destino', 'ajuda'],
    ['whatsapp_numero_bloqueado', null, '/ajuda#numero-bloqueado', 'ajuda'],
    ['whatsapp_sessao_invalidada', null, '/#pareamento', 'operacao'],
    ['whatsapp_desconectado', null, '/#pareamento', 'operacao'],
    ['tag_invalida', null, '/#afiliado', 'afiliado'],
    ['limite', null, '/#horarios', 'horarios'],
    ['horario_invalido', null, '/#horarios', 'horarios'],
    ['muitas_falhas', null, '/ajuda#falhas', 'ajuda'],
    ['pausado_por_falhas', null, '/ajuda#falhas', 'ajuda'],
    ['tipo_novo', null, '/ajuda', 'ajuda'],
    ['nova_fonte', null, '/ajuda', 'ajuda'],
    ['novo_whatsapp', null, '/ajuda', 'ajuda'],
  ] as const;
  for (const [tipo, fonte, path, tab] of cases) {
    const link = repairLink(tipo, fonte);
    assert.equal(link, path, tipo);
    const url = new URL(link, 'https://painel.example.test');
    assert.equal(getTabFromHash(url.hash, url.pathname), tab, tipo);
  }
});

test('pendencias usam o endpoint dedicado e preservam excecoes e envios incertos', async () => {
  const original = globalThis.fetch;
  const pending = {
    excecoes: [{ id: 'exemplo', tipo: 'fonte_perdida', descricao: 'Fonte de exemplo perdida' }],
    envios: [{ id: 'envio-exemplo', estado: 'incerto', erro: null }],
  };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/pendencias');
    assert.equal(init?.credentials, 'include');
    return Response.json(pending);
  };
  try {
    assert.deepEqual(await operations.pending(), pending);
  } finally {
    globalThis.fetch = original;
  }
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
