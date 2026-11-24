// Bot API com fetch mockado. Nenhuma chamada real ao Telegram. Ids e token são dados de exemplo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBotSource } from '../src/bot.ts';
import type { ExceptionSink, SourceMessage } from '../src/types.ts';

const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWX_exemplo';
const FONTE = '-1001111111111';
const OUTRO = '-1002222222222';

type Reply = Record<string, unknown> | Error;

function fakeFetch(replies: Reply[]) {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = url instanceof Request ? url.url : url.toString();
    calls.push({
      method: u.split('/').pop()!,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const next = replies.shift();
    if (!next)
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
      );
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next));
  }) as typeof fetch;
  return { calls, impl };
}

function sink() {
  const log: string[] = [];
  const s: ExceptionSink & { log: string[] } = {
    log,
    async open(e) {
      log.push(`open:${e.tipo}:${e.grupoExternoId ?? '-'}`);
    },
    async resolve(t, g) {
      log.push(`resolve:${t}:${g ?? '-'}`);
    },
  };
  return s;
}

const until = async (cond: () => boolean, ms = 1000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
};

function setup(replies: Reply[], over: Partial<Parameters<typeof createBotSource>[0]> = {}) {
  const f = fakeFetch(replies);
  const exceptions = sink();
  const sleeps: number[] = [];
  const errors: unknown[] = [];
  const src = createBotSource({
    token: TOKEN,
    fontes: [FONTE],
    exceptions,
    fetchImpl: f.impl,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
    onError: (e) => errors.push(e),
    ...over,
  });
  const got: SourceMessage[] = [];
  src.onMessage((m) => got.push(m));
  return { src, f, exceptions, sleeps, errors, got };
}

const ok = (result: unknown) => ({ ok: true, result });

test('lê post de canal e mensagem com legenda só das fontes permitidas, sem remetente, e avança o offset', async () => {
  const { src, f, got } = setup([
    ok([
      {
        update_id: 10,
        channel_post: {
          message_id: 5,
          date: 1795000000,
          chat: { id: Number(FONTE) },
          text: 'Oferta https://amzn.to/x',
          author_signature: 'Fulano',
        },
      },
      {
        update_id: 11,
        message: {
          message_id: 6,
          date: 1795000060,
          chat: { id: Number(FONTE) },
          caption: 'Foto da oferta',
          from: { id: 99, first_name: 'Fulano', username: 'fulano' },
        },
      },
      { update_id: 12, channel_post: { message_id: 7, date: 1795000000, chat: { id: Number(OUTRO) }, text: 'outra' } },
      { update_id: 13, channel_post: { message_id: 8, date: 1795000000, chat: { id: Number(FONTE) } } },
    ]),
  ]);
  await src.start();
  await until(() => f.calls.length >= 2);
  await src.stop();
  assert.deepEqual(got, [
    {
      plataforma: 'telegram',
      grupoExternoId: FONTE,
      mensagemExternaId: '5',
      texto: 'Oferta https://amzn.to/x',
      publicadaEm: 1795000000000,
    },
    {
      plataforma: 'telegram',
      grupoExternoId: FONTE,
      mensagemExternaId: '6',
      texto: 'Foto da oferta',
      publicadaEm: 1795000060000,
    },
  ]);
  assert.ok(!JSON.stringify(got).includes('Fulano') && !JSON.stringify(got).includes('fulano'));
  assert.equal(f.calls[1].body.offset, 14);
  assert.deepEqual(f.calls[0].body.allowed_updates, ['message', 'channel_post', 'my_chat_member']);
});

test('só lê: toda chamada é getUpdates', async () => {
  const { src, f } = setup([ok([]), ok([])]);
  await src.start();
  await until(() => f.calls.length >= 3);
  await src.stop();
  assert.ok(f.calls.every((c) => c.method === 'getUpdates'));
});

test('token revogado (401) e outra instância (409): sessao_invalidada e para de ler', async () => {
  for (const code of [401, 409]) {
    const { src, f, exceptions } = setup([{ ok: false, error_code: code, description: 'x' }]);
    await src.start();
    await until(() => src.status() === 'sessao_invalida');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(f.calls.length, 1, `não insiste (${code})`);
    assert.ok(exceptions.log.includes('open:sessao_invalidada:-'));
    await src.stop();
  }
});

test('429 espera o retry_after antes de tentar de novo', async () => {
  const { src, f, sleeps } = setup([{ ok: false, error_code: 429, parameters: { retry_after: 7 } }, ok([])]);
  await src.start();
  await until(() => f.calls.length >= 3);
  await src.stop();
  assert.equal(sleeps[0], 7000);
});

test('queda de rede: reconecta com backoff; sem aviso se voltar antes do limite', async () => {
  const { src, f, sleeps, exceptions } = setup([new TypeError('fetch failed'), new TypeError('fetch failed'), ok([])]);
  await src.start();
  await until(() => f.calls.length >= 4);
  await src.stop();
  assert.deepEqual(sleeps.slice(0, 2), [500, 1000]);
  assert.ok(!exceptions.log.some((l) => l.startsWith('open:desconectado')));
  assert.ok(exceptions.log.includes('resolve:desconectado:-'));
});

test('queda que passa do limite (10 min em produção) vira aviso desconectado', async () => {
  const { src, exceptions } = setup([new TypeError('fetch failed')], { disconnectAlertMs: 20 });
  await src.start();
  await until(() => exceptions.log.includes('open:desconectado:-'));
  await src.stop();
  assert.ok(exceptions.log.includes('open:desconectado:-'));
});

test('bot removido de uma fonte: removido_do_grupo; readicionado: resolve', async () => {
  const member = (status: string, update_id: number) => ({
    update_id,
    my_chat_member: { chat: { id: Number(FONTE) }, new_chat_member: { status } },
  });
  const { src, f, exceptions } = setup([ok([member('kicked', 1)]), ok([member('administrator', 2)])]);
  await src.start();
  await until(() => f.calls.length >= 3);
  await src.stop();
  assert.ok(exceptions.log.includes(`open:removido_do_grupo:${FONTE}`));
  assert.ok(exceptions.log.includes(`resolve:removido_do_grupo:${FONTE}`));
});

test('o token nunca vaza em erro de rede', async () => {
  const { src, errors } = setup([new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getUpdates`)]);
  await src.start();
  await until(() => errors.length > 0);
  await src.stop();
  assert.ok(errors.length > 0);
  assert.ok(!errors.some((e) => String((e as Error).message).includes(TOKEN)));
});

test('token com formato inválido é recusado na criação', () => {
  assert.throws(() => setup([], { token: 'sem-formato' }), /formato/);
});
