import { test } from 'node:test';
import assert from 'node:assert/strict';
import { g0, g1, g2, g3, g4, g5, g6, g7, g8, g9 } from '../src/gates.js';
const now = Date.parse('2026-11-23T15:00:00Z');
test('G0: autorizacao, idade e data futura falham fechadas', () => {
  assert.equal(g0({ ativa: true, autorizada: true, publicadaEm: now }, now).status, 'PASSA');
  assert.equal(g0({ ativa: true, autorizada: false, publicadaEm: now }, now).status, 'REPROVA');
  assert.equal(g0({ ativa: true, autorizada: true, publicadaEm: now - 31 * 60000 }, now).status, 'REPROVA');
  assert.equal(g0({ ativa: true, autorizada: true, publicadaEm: NaN }, now).status, 'REPROVA');
  assert.equal(g0({ ativa: true, autorizada: true, publicadaEm: now + 1 }, now).status, 'REPROVA');
});
test('G1/G2: URL, loja e ASIN canonico', () => {
  assert.equal(g1([]).status, 'REPROVA');
  assert.equal(g1(['https://amzn.to/test']).status, 'PASSA');
  assert.equal(g2({ ok: true, store: 'amazon', asin: 'CURTO' }).status, 'REPROVA');
  assert.equal(g2({ ok: false, reason: 'loja_nao_suportada' }).status, 'REPROVA');
});
test('G3: janela 24h e queda opcional no limite', () => {
  assert.equal(g3({ enviadoEm: now - 1000, precoCentavos: 10000 }, now).status, 'REPROVA');
  assert.equal(g3({ enviadoEm: now - 24 * 3600000, precoCentavos: 10000 }, now).status, 'PASSA');
  assert.equal(g3({ enviadoEm: now - 1000, precoCentavos: 10000 }, now, { quedaPercentual: 10, precoAtualCentavos: 9000 }).status, 'PASSA');
  assert.equal(g3({ enviadoEm: now - 1000, precoCentavos: 10000 }, now, { quedaPercentual: 10, precoAtualCentavos: 9001 }).status, 'REPROVA');
});
const product = { asin: 'B012345678', pageAsin: 'B012345678', title: 'Suporte veicular', priceCents: 10000, available: true, image: 'https://images.example.test/photo.jpg', checkedAt: new Date(now).toISOString() };
test('G4: rede adia, produto incompleto/variante/estoque rejeita', () => {
  assert.equal(g4({ ok: true, product }, product.asin, now).status, 'PASSA');
  assert.equal(g4({ ok: false, reason: 'rede:TimeoutError' }, product.asin, now).status, 'ADIA');
  assert.equal(g4({ ok: false, reason: 'produto_inexistente' }, product.asin, now).status, 'REPROVA');
  for (const p of [{ ...product, available: null }, { ...product, priceCents: NaN }, { ...product, pageAsin: 'B099999999' }, { ...product, image: null }]) assert.equal(g4({ ok: true, product: p }, product.asin, now).status, 'REPROVA');
});
test('G5: dependencia de nicho, categoria e titulo oficial', () => {
  assert.equal(g5({ status: 'REPROVA', motivo: 'fora_do_nicho', motivoDescritivo: 'fora do nicho' }).status, 'REPROVA');
  assert.equal(g5({ status: 'PASSA' }, 'casa', ['carros']).status, 'REPROVA');
  assert.equal(g5({ status: 'PASSA' }, null, ['carros']).status, 'PASSA');
  assert.equal(g5({ status: 'PASSA' }, 'carros', ['carros']).status, 'PASSA');
});
test('G6: tolerancia 5% e preco de origem ausente', () => {
  assert.equal(g6(10500, 10000).status, 'PASSA');
  assert.equal(g6(10501, 10000).status, 'REPROVA');
  assert.equal(g6(10000, null).status, 'PASSA');
  assert.equal(g6(NaN, 10000).status, 'REPROVA');
});
test('G6: cupom legivel reduz so o preco de comparacao; ilegivel sempre reprova', () => {
  assert.equal(g6(12000, 10000, { presente: true, legivel: true, valorCentavos: 2000 }).status, 'PASSA');
  assert.equal(g6(12000, 10000, { presente: true, legivel: true, percentual: 20 }).status, 'PASSA');
  assert.equal(g6(12000, 10000, { presente: false, legivel: true }).status, 'REPROVA');
  const bad = g6(10000, null, { presente: true, legivel: false });
  assert.deepEqual(bad, { status: 'REPROVA', motivo: 'cupom_ilegivel' });
  for (const cupom of [{ presente: true, legivel: true }, { presente: true, legivel: true, percentual: NaN }, { presente: true, legivel: true, valorCentavos: 20000 }]) assert.equal(g6(10000, 10000, cupom).status, 'REPROVA');
});
test('G7: estrutura exata, tag do cliente e nenhum tracking alheio', () => {
  const link = 'https://www.amazon.com.br/dp/B012345678?tag=cliente-20';
  assert.equal(g7('B012345678', 'cliente-20', link).status, 'PASSA');
  for (const bad of [link + '&other=x', link.replace('cliente-20', 'terceiro-20'), link.replace('www.amazon.com.br', 'amazon.com.br.evil.test')]) assert.equal(g7('B012345678', 'cliente-20', bad).status, 'REPROVA');
});
test('G8: falha no validador reprova', () => {
  assert.equal(g8({ valida: false, status: 'REPROVA' }).status, 'REPROVA');
  assert.equal(g8({ valida: true, status: 'PASSA' }).status, 'PASSA');
});
test('G9: TTL desde captura e desde entrada na fila, limite exato', () => {
  assert.equal(g9(now - 120 * 60000, now - 60000, now).status, 'PASSA');
  assert.equal(g9(now - 120 * 60000 - 1, now, now).status, 'REPROVA');
  assert.equal(g9(now, now + 1, now).status, 'REPROVA');
});

test('G4 respeita retryAt futuro e recua para cinco minutos se invalido', () => {
  const retryAt = now + 30 * 60000;
  assert.deepEqual(g4({ ok: false, reason: 'bloqueado_captcha', retryAt }, product.asin, now), { status: 'ADIA', motivo: 'bloqueado_captcha', quando: retryAt });
  for (const value of [NaN, now - 1]) assert.deepEqual(g4({ ok: false, reason: 'rede', retryAt: value }, product.asin, now), { status: 'ADIA', motivo: 'rede', quando: now + 5 * 60000 });
});
