import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, runBeforeSend } from '../src/pipeline.js';
import { nicheGate } from '../src/niche.js';
import { renderMessage, validateMessage } from '../src/message.js';
import { resolve } from '../src/resolve.js';
import type { GateEvent, PipelineDependencies, PipelineConfig, PipelineInput, ProductSnapshot } from '../src/pipeline-types.js';
const time = Date.parse('2026-11-23T15:00:00Z');
const p: ProductSnapshot = { asin: 'B012345678', pageAsin: 'B012345678', title: 'Suporte veicular para carro', priceCents: 10000, image: 'https://images.example.test/p.jpg', available: true, checkedAt: new Date(time).toISOString() };
const input: PipelineInput = { mensagemId: 'raw', texto: 'Texto da fonte https://www.amazon.com.br/dp/B012345678?tag=terceiro-20', fonte: { id: 'source', ativa: true, autorizada: true }, publicadaEm: time, recebidaEm: time, precoFonteCentavos: 10000 };
const config: PipelineConfig = { fontesPermitidas: ['source'], tagAmazon: 'cliente-20', nicho: { palavras_chave: ['carro'], palavras_bloqueadas: ['brinquedo'] } };
function setup() {
  const events: GateEvent[] = [];
  let now = time, reads = 0;
  const d: PipelineDependencies = { now: () => now, resolve, lastSend: async () => null,
    reader: { read: async () => { reads++; return { ok: true, product: { ...p, checkedAt: new Date(now).toISOString() } }; } },
    record: async e => { events.push(e); }, nicheGate, renderMessage, validateMessage };
  return { d, events, reads: () => reads, advance: (ms: number) => { now += ms; } };
}
test('pipeline roda G0-G8 em ordem com dependencia real de J1/J3; G9 so no envio', async () => {
  const s = setup(); const out = await runPipeline(input, config, s.d);
  assert.equal(out.resultado.status, 'PASSA'); assert.equal(out.gate, 8); assert.ok(out.mensagem);
  assert.deepEqual(s.events.map(e => e.gate), [0,1,2,3,4,5,6,7,8]);
  assert.equal(s.events[0].asin, undefined); assert.equal(s.events[2].asin, p.asin);
  const check = await runBeforeSend({ input, config, asin: p.asin, produto: out.produto!, enfileiradaEm: time }, s.d);
  assert.equal(check.resultado.status, 'PASSA'); assert.equal(s.reads(), 1);
});
test('ADIA interrompe antes dos proximos gates; falha de persistencia aborta', async () => {
  const s = setup(); s.d.reader.read = async () => ({ ok: false, reason: 'bloqueado_captcha' });
  const out = await runPipeline(input, config, s.d);
  assert.equal(out.resultado.status, 'ADIA'); assert.equal(out.gate, 4); assert.equal(s.events.length, 5);
  s.d.record = async () => { throw new Error('banco indisponivel'); };
  await assert.rejects(runPipeline(input, config, s.d), /banco indisponivel/);
});
test('dedup encerra antes de ler; excecao de queda usa novo preco', async () => {
  const s = setup(); s.d.lastSend = async () => ({ enviadoEm: time - 60000, precoCentavos: 12000 });
  assert.equal((await runPipeline(input, config, s.d)).gate, 3); assert.equal(s.reads(), 0);
  assert.equal((await runPipeline(input, { ...config, quedaPercentual: 10 }, s.d)).resultado.status, 'PASSA'); assert.equal(s.reads(), 1);
});
test('G9 apos 30min rele G4/G6 e renderiza preco/hora novos', async () => {
  const s = setup(); s.advance(31 * 60000);
  s.d.reader.read = async () => ({ ok: true, product: { ...p, priceCents: 9000, checkedAt: new Date(s.d.now()).toISOString() } });
  const out = await runBeforeSend({ input, config, asin: p.asin, produto: p, enfileiradaEm: time }, s.d);
  assert.equal(out.resultado.status, 'PASSA'); assert.equal(out.produto?.priceCents, 9000); assert.match(out.mensagem!.texto, /90,00/);
  assert.deepEqual(s.events.map(e => e.gate), [4,5,6,7,8,9]);
  s.d.reader.read = async () => ({ ok: true, product: { ...p, priceCents: 11000, checkedAt: new Date(s.d.now()).toISOString() } });
  const expired = await runBeforeSend({ input, config, asin: p.asin, produto: p, enfileiradaEm: time }, s.d);
  assert.equal(expired.resultado.status, 'REPROVA');
});
test('G9 TTL vencido nao le produto e fonte nao autorizada nao resolve', async () => {
  const s = setup(); s.advance(121 * 60000);
  assert.equal((await runBeforeSend({ input, config, asin: p.asin, produto: p, enfileiradaEm: time }, s.d)).resultado.status, 'REPROVA'); assert.equal(s.reads(), 0);
  assert.equal((await runPipeline({ ...input, fonte: { ...input.fonte, autorizada: false } }, config, s.d)).gate, 0);
});
test('cupom reduz so a comparacao G6; mensagem publica preco integral e aviso', async () => {
  const s = setup(); s.d.reader.read = async () => ({ ok: true, product: { ...p, priceCents: 12000, cupom: { presente: true, legivel: true, valorCentavos: 2000 } } });
  const out = await runPipeline(input, config, s.d);
  assert.equal(out.resultado.status, 'PASSA');
  assert.match(out.mensagem!.texto, /120,00/); assert.doesNotMatch(out.mensagem!.texto, /100,00/);
  assert.equal(out.mensagem!.temCupom, true);
  assert.match(out.mensagem!.texto, /cupom/i);
});

test('G9 usa a mesma validade configurada para releitura e G4', async () => {
  const s = setup(); s.advance(40 * 60000);
  const queued = { input, config: { ...config, reverAposMs: 45 * 60000 }, asin: p.asin, produto: p, enfileiradaEm: time };
  assert.equal((await runBeforeSend(queued, s.d)).resultado.status, 'PASSA'); assert.equal(s.reads(), 0);
  s.advance(6 * 60000);
  assert.equal((await runBeforeSend(queued, s.d)).resultado.status, 'PASSA'); assert.equal(s.reads(), 1);
});
