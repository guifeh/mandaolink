// Testes offline. fixtures/pagina-B0FN8CH3KG.html é recorte de uma página real (23/11/2026);
// fixtures/captcha.html é a página de captcha real recebida com UA divergente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectBlock, parseCoupon, parsePriceCents, parseProductHtml } from './parse.ts';
import { createAmazonReader, createFetchReader, type ProductReader, type ReadResult } from './reader.ts';

const real = readFileSync(new URL('../fixtures/pagina-B0FN8CH3KG.html', import.meta.url), 'utf8');
const captcha = readFileSync(new URL('../fixtures/captcha.html', import.meta.url), 'utf8');

test('lê título, preço, foto, disponibilidade e canonical de uma página real', () => {
  const p = parseProductHtml('B0FN8CH3KG', real, new Date('2026-11-23T19:00:00Z'));
  assert.equal(p.title, 'Suporte Veicular Celular GPS Ventosa Trava Automática Painel Para-Brisa');
  assert.equal(p.priceCents, 2840);
  assert.equal(p.priceText, 'R$ 28,40');
  assert.match(p.image!, /^https:\/\/m\.media-amazon\.com\/images\/I\/.+\.jpg$/);
  assert.equal(p.available, true);
  assert.equal(p.pageAsin, 'B0FN8CH3KG');
  assert.equal(p.checkedAt, '2026-11-23T19:00:00.000Z');
});

test('sem o campo do formulário, cai para o span priceToPay do bloco principal', () => {
  const semForm = real.replace(/<input[^>]*customerVisiblePrice[^>]*>/, '');
  assert.equal(parseProductHtml('B0FN8CH3KG', semForm).priceCents, 2840);
});

test('não pega preço solto fora do bloco principal (falha fechada)', () => {
  const html = '<span id="productTitle">X</span><span class="a-price"><span class="a-offscreen">R$ 9,99</span></span>';
  assert.equal(parseProductHtml('B0EXEMPLO1', html).priceCents, null);
});

test('indisponível; ignora o JSON de script dentro do bloco', () => {
  const html =
    '<span id="productTitle">X</span><div id="availability"><span> Atualmente indisponível. </span><script>{"a":"disponível"}</script></div>';
  assert.equal(parseProductHtml('B0EXEMPLO1', html).available, false);
  const ok = '<div id="availability"><span>Em estoque</span><script>{"x":"indisponível"}</script></div>';
  assert.equal(parseProductHtml('B0EXEMPLO1', ok).available, true);
});

const fx = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

test('cupom do produto real: "Aplicar Cupom de 5%"', () => {
  const p = parseProductHtml('B0HDXCR3V7', fx('pagina-B0HDXCR3V7-cupom.html'));
  assert.deepEqual(p.cupom, { presente: true, legivel: true, percentual: 5 });
  assert.equal(p.priceCents, 2390);
});

test('promoção geral de primeira compra (código PRIMEIRA20BF) não conta como cupom do produto', () => {
  const p = parseProductHtml('B0DW9BYSCZ', fx('pagina-B0DW9BYSCZ-promo-geral.html'));
  assert.deepEqual(p.cupom, { presente: false, legivel: true });
});

test('cupom em reais e cupom sem valor legível', () => {
  const brl = '<span id="couponTextX" class="couponLabelText"> Aplicar Cupom de R$ 15,00 <span>Termos</span>';
  assert.deepEqual(parseCoupon(brl), { presente: true, legivel: true, valorCentavos: 1500 });
  const vago = '<span id="couponTextX" class="couponLabelText"> Aplicar cupom <a>Termos</a>';
  assert.deepEqual(parseCoupon(vago), { presente: true, legivel: false });
  const semMarcacao = '<div id="promoPriceBlockMessage_feature_div"><label>Aplicar cupom de 10%</label></div>';
  assert.deepEqual(parseCoupon(semMarcacao), { presente: true, legivel: false });
});

test('produto sem oferta destacada ("Ver todas as opções de compra") fica sem preço', () => {
  const p = parseProductHtml('B0FLW41Q2X', fx('pagina-B0FLW41Q2X-sem-oferta.html'));
  assert.equal(p.priceCents, null);
  assert.notEqual(p.title, null);
});

test('converte preço em reais para centavos', () => {
  assert.equal(parsePriceCents('R$ 1.299,90'), 129990);
  assert.equal(parsePriceCents('R$39,90'), 3990);
  assert.equal(parsePriceCents(null), null);
});

test('detecta captcha real e 503 de bloqueio; página de produto não é bloqueio', () => {
  assert.equal(detectBlock(200, captcha), 'bloqueado_captcha');
  assert.equal(detectBlock(503, '<html>Desculpe</html>'), 'bloqueado_http_503');
  assert.equal(detectBlock(200, real), null);
});

test('fetch reader: 404 vira produto_inexistente e erro de rede vira rede:*', async () => {
  const r404 = await createFetchReader({ fetchImpl: async () => new Response('x', { status: 404 }) }).read(
    'B0EXEMPLO1',
  );
  assert.deepEqual([r404.ok, !r404.ok && r404.reason], [false, 'produto_inexistente']);
  const rNet = await createFetchReader({
    fetchImpl: async () => {
      throw new TypeError('fetch failed');
    },
  }).read('B0EXEMPLO1');
  assert.deepEqual([rNet.ok, !rNet.ok && rNet.reason], [false, 'rede:TypeError']);
});

function fake(results: ReadResult[]): ProductReader & { calls: number } {
  const r = {
    calls: 0,
    async read() {
      return results[Math.min(r.calls++, results.length - 1)];
    },
    async close() {},
  };
  return r;
}
const blocked: ReadResult = { ok: false, reason: 'bloqueado_captcha', via: 'fetch', ms: 1 };
const good: ReadResult = { ok: true, product: parseProductHtml('B0FN8CH3KG', real), via: 'browser', ms: 1 };

test('bloqueio no fetch tenta o navegador; bloqueio nos dois pausa e não lê mais', async () => {
  let t = 0;
  const opts = { now: () => t, sleep: async (ms: number) => void (t += ms) };

  const primary = fake([blocked]);
  const fallback = fake([good]);
  const r1 = await createAmazonReader({ primary, fallback, ...opts }).read('B0FN8CH3KG');
  assert.equal(r1.ok, true);
  assert.equal(fallback.calls, 1);

  const p2 = fake([blocked]);
  const f2 = fake([{ ...blocked, via: 'browser' }]);
  const reader = createAmazonReader({ primary: p2, fallback: f2, ...opts });
  assert.equal((await reader.read('B0FN8CH3KG')).ok, false);
  const blockedAt = t;
  t += 29 * 60_000;
  const r3 = await reader.read('B0FN8CH3KG');
  assert.equal(!r3.ok && r3.reason, 'em_pausa_por_bloqueio');
  assert.equal(!r3.ok && r3.retryAt, blockedAt + 30 * 60_000, 'pausa fixa de 30 min');
  assert.equal(p2.calls, 1, 'não bate na Amazon durante a pausa');
  t = blockedAt + 30 * 60_000 + 1;
  await reader.read('B0FN8CH3KG');
  assert.equal(p2.calls, 2, 'volta a ler depois do cooldown');
});

test('ritmo fixo: 2 a 4 s entre leituras e chamadas paralelas serializadas', async () => {
  let t = 0;
  const waits: number[] = [];
  const reader = createAmazonReader({
    primary: fake([good]),
    now: () => t,
    sleep: async (ms) => {
      waits.push(ms);
      t += ms;
    },
  });
  await Promise.all([reader.read('B0FN8CH3KG'), reader.read('B0FN8CH3KG'), reader.read('B0FN8CH3KG')]);
  assert.equal(waits.length, 2);
  for (const w of waits) assert.ok(w >= 2000 && w <= 4000, `espera ${w}`);
});

test('ASIN inválido não chega a fazer requisição', async () => {
  const primary = fake([good]);
  const r = await createAmazonReader({ primary }).read('nao-e-asin');
  assert.equal(!r.ok && r.reason, 'asin_invalido');
  assert.equal(primary.calls, 0);
});
