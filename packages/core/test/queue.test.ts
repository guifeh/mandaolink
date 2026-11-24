import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dispatchNext, sendingWindow, type DispatchState, type QueueItem, type QueueStore, type QueueDependencies } from '../src/send-queue.js';
const initial = Date.parse('2026-11-23T12:00:00Z');
function setup() {
  let now = initial, locked = false, calls = 0;
  const attempted: number[] = [];
  const items = new Map<string, QueueItem & { status: string; eligible: number }>();
  const state: DispatchState = { pausado: false, limiteHora: 5, limiteDia: 30, horarioInicio: '08:00', horarioFim: '22:00', fuso: 'America/Sao_Paulo', contagemHora: 0, contagemDia: 0, proximoEm: 0 };
  const store: QueueStore = {
    lock: async work => { if (locked) return null; locked = true; try { return await work(); } finally { locked = false; } },
    expire: async t => { for (const item of items.values()) if (item.status === 'na_fila' && t - item.input.recebidaEm > 2 * 3600000) item.status = 'descartado'; },
    state: async t => ({ ...state, contagemHora: state.contagemHora + attempted.filter(n => n > t - 3600000).length, contagemDia: state.contagemDia + attempted.length }),
    next: async t => [...items.values()].filter(i => i.status === 'na_fila' && i.eligible <= t).sort((a,b) => b.enfileiradaEm - a.enfileiradaEm)[0] ?? null,
    discard: async id => { items.get(id)!.status = 'descartado'; }, defer: async (id, t) => { items.get(id)!.eligible = t; },
    claim: async (item, _result, t, next) => { const row = items.get(item.id)!; if (row.status !== 'na_fila') return false; row.status = 'incerto'; attempted.push(t); state.proximoEm = next; return true; },
    confirmed: async id => { items.get(id)!.status = 'enviado'; }, uncertain: async () => {},
    notTransmitted: async id => { items.get(id)!.status = 'falhou'; }
  };
  const add = (id: string, created = now) => {
    const item: QueueItem = { id, destinoId: 'teste', idempotencyKey: id, asin: 'B012345678', enfileiradaEm: created,
      input: { mensagemId: id, texto: 'Fonte sintetica', fonte: { id: 'source', ativa: true, autorizada: true }, publicadaEm: created, recebidaEm: created },
      config: { fontesPermitidas: ['source'], tagAmazon: 'cliente-20', nicho: { palavras_chave: ['carro'], palavras_bloqueadas: [] } },
      produto: { asin: 'B012345678', pageAsin: 'B012345678', title: 'Carro', priceCents: 1000, image: 'https://example.test/p.jpg', checkedAt: new Date(now).toISOString(), available: true } };
    items.set(id, { ...item, status: 'na_fila', eligible: 0 }); return item;
  };
  const d: QueueDependencies = { store, now: () => now, random: () => 0,
    validate: async item => ({ gate: 9, resultado: { status: 'PASSA' }, produto: item.produto,
      mensagem: { texto: 'Texto validado', mediaUrl: item.produto.image, tituloCurto: 'Carro', precoFormatado: 'R$ 10,00', horaPreco: '09:00', linkAfiliado: 'link', temCupom: false } }),
    publisher: { send: async msg => { calls++; assert.equal(items.get(msg.idempotencyKey)!.status, 'incerto'); return { status: 'enviado', mensagemId: 'ack' }; } }
  };
  return { d, state, items, add, calls: () => calls, advance: (ms: number) => { now += ms; } };
}
test('fila escolhe mais nova e respeita intervalo 3min; reserva antes de publicar', async () => {
  const s = setup(); s.add('antiga', initial - 60000); s.add('nova');
  assert.equal(await dispatchNext(s.d), 'enviado'); assert.equal(s.items.get('nova')!.status, 'enviado');
  assert.equal(await dispatchNext(s.d), 'intervalo'); s.advance(180000);
  assert.equal(await dispatchNext(s.d), 'enviado'); assert.equal(s.calls(), 2);
});
test('intervalo no extremo de 8min, pausa geral e horario local', async () => {
  const s = setup(); s.add('one'); s.d.random = () => 1;
  assert.equal(await dispatchNext(s.d), 'enviado'); s.add('two'); s.advance(479999);
  assert.equal(await dispatchNext(s.d), 'intervalo'); s.advance(1); s.state.pausado = true;
  assert.equal(await dispatchNext(s.d), 'pausado'); assert.equal(s.calls(), 1);
  assert.equal(sendingWindow(Date.parse('2026-11-23T11:00:00Z'), '08:00', '22:00', 'America/Sao_Paulo'), true);
  assert.equal(sendingWindow(Date.parse('2026-11-24T01:00:00Z'), '08:00', '22:00', 'America/Sao_Paulo'), false);
});
test('limites horario e diario nao enviam alem da capacidade', async () => {
  const s = setup(); s.add('one'); s.state.contagemHora = 5;
  assert.equal(await dispatchNext(s.d), 'limite'); s.state.contagemHora = 0; s.state.contagemDia = 30;
  assert.equal(await dispatchNext(s.d), 'limite'); assert.equal(s.calls(), 0);
});
test('TTL descarta, ADIA segura e REPROVA nunca publica', async () => {
  const s = setup(); s.add('vencida', initial - 121 * 60000);
  assert.equal(await dispatchNext(s.d), 'vazia'); assert.equal(s.items.get('vencida')!.status, 'descartado');
  s.add('retida'); s.d.validate = async () => ({ gate: 9, resultado: { status: 'ADIA', motivo: 'rede', quando: initial + 300000 } });
  assert.equal(await dispatchNext(s.d), 'adiado'); assert.equal(await dispatchNext(s.d), 'vazia'); s.advance(300000);
  s.d.validate = async () => ({ gate: 9, resultado: { status: 'REPROVA', motivo: 'preco mudou' } });
  assert.equal(await dispatchNext(s.d), 'descartado'); assert.equal(s.calls(), 0);
});
test('timeout/rejeicao ambiguos permanecem incertos e nunca voltam a fila', async () => {
  const s = setup(); s.add('one'); s.d.publisher.send = async () => { throw new Error('sem ack'); };
  assert.equal(await dispatchNext(s.d), 'incerto'); s.advance(8 * 60000);
  assert.equal(await dispatchNext(s.d), 'vazia'); assert.equal(s.items.get('one')!.status, 'incerto');
});
test('erro comprovado antes de transmitir vira falhou e locks impedem concorrencia', async () => {
  const s = setup(); s.add('one'); s.d.publisher.send = async () => ({ status: 'falhou', naoTransmitido: true, motivo: 'sem sessao' });
  const results = await Promise.all([dispatchNext(s.d), dispatchNext(s.d)]);
  assert.ok(results.includes('falhou')); assert.ok(results.includes('ocupado'));
});
test('pausa durante G9 impede reserva e expiracao durante leitura descarta', async () => {
  const s = setup(); s.add('one'); const validate = s.d.validate;
  s.d.validate = async item => { const checked = await validate(item); s.state.pausado = true; return checked; };
  assert.equal(await dispatchNext(s.d), 'pausado'); assert.equal(s.calls(), 0); assert.equal(s.items.get('one')!.status, 'na_fila');
  s.state.pausado = false;
  s.d.validate = async item => { const checked = await validate(item); s.advance(121 * 60000); return checked; };
  assert.equal(await dispatchNext(s.d), 'descartado'); assert.equal(s.calls(), 0);
});
