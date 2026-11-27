// MTProto com cliente mockado. Nenhuma conta é conectada. Ids são dados de exemplo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyMtprotoError,
  createMtprotoSource,
  type MtClient,
  type MtConnection,
  type MtMessage,
} from '../src/mtproto.ts';
import { loadSession, parseSessionKey, saveSession } from '../src/session-store.ts';
import type { ExceptionSink, SourceMessage } from '../src/types.ts';

const CANAL = '-1003333333333';

class FakeMt implements MtClient {
  connects = 0;
  subscribedChats: string[] | null = null;
  connectErrors: Error[] = [];
  private msg: ((m: MtMessage) => void) | null = null;
  private conn: ((s: MtConnection) => void) | null = null;
  async connect() {
    this.connects++;
    const e = this.connectErrors.shift();
    if (e) throw e;
  }
  async disconnect() {}
  onNewMessage(chats: string[], h: (m: MtMessage) => void) {
    this.subscribedChats = chats;
    this.msg = h;
  }
  onConnectionChange(h: (s: MtConnection) => void) {
    this.conn = h;
  }
  push(m: MtMessage) {
    this.msg?.(m);
  }
  state(s: MtConnection) {
    this.conn?.(s);
  }
}

function sink() {
  const log: string[] = [];
  const s: ExceptionSink & { log: string[] } = {
    log,
    async open(e) {
      log.push(`open:${e.tipo}`);
    },
    async resolve(t) {
      log.push(`resolve:${t}`);
    },
  };
  return s;
}
const until = async (cond: () => boolean, ms = 1000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
};

function setup(over: Partial<Parameters<typeof createMtprotoSource>[0]> = {}) {
  const client = new FakeMt();
  const exceptions = sink();
  const src = createMtprotoSource({
    client,
    canais: [CANAL],
    exceptions,
    sleep: async () => {},
    random: () => 0,
    ...over,
  });
  const got: SourceMessage[] = [];
  src.onMessage((m) => got.push(m));
  return { client, exceptions, src, got };
}

test('assina só os canais da allowlist e emite mensagem sem remetente', async () => {
  const { client, src, got } = setup();
  await src.start();
  assert.deepEqual(client.subscribedChats, [CANAL]);
  assert.equal(src.status(), 'conectado');
  client.push({ chatId: CANAL, id: 42, text: 'Oferta https://amzn.to/y', date: 1795000000 });
  client.push({ chatId: '-1009999999999', id: 43, text: 'não autorizado', date: 1795000000 });
  client.push({ chatId: CANAL, id: 44, text: '', date: 1795000000 });
  await until(() => got.length >= 1);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(got, [
    {
      plataforma: 'telegram',
      grupoExternoId: CANAL,
      mensagemExternaId: '42',
      texto: 'Oferta https://amzn.to/y',
      publicadaEm: 1795000000000,
    },
  ]);
  await src.stop();
});

test('canal removido da allowlist depois da assinatura deixa de ser lido', async () => {
  let canais = [CANAL];
  const { client, src, got } = setup({ canais: () => canais });
  await src.start();
  canais = [];
  client.push({ chatId: CANAL, id: 1, text: 'x', date: 1795000000 });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(got.length, 0);
  await src.stop();
});

test('sem canal autorizado não assina nada (filtro vazio = todos os chats); username é recusado', async () => {
  await assert.rejects(setup({ canais: [] }).src.start(), /sem_canais_autorizados/);
  await assert.rejects(setup({ canais: ['@canalpublico'] }).src.start(), /id numérico/);
});

test('sessão encerrada e conta banida: avisos distintos e sem nova tentativa', async () => {
  for (const [erro, tipo, status] of [
    ['AUTH_KEY_UNREGISTERED', 'sessao_invalidada', 'sessao_invalida'],
    ['SESSION_REVOKED', 'sessao_invalidada', 'sessao_invalida'],
    ['USER_DEACTIVATED_BAN', 'numero_bloqueado', 'numero_bloqueado'],
  ] as const) {
    const { client, src, exceptions } = setup();
    client.connectErrors = [new Error(`401: ${erro} (caused by help.GetConfig)`)];
    await src.start();
    assert.equal(src.status(), status);
    assert.equal(client.connects, 1, `não insiste (${erro})`);
    assert.ok(exceptions.log.includes(`open:${tipo}`));
  }
  assert.equal(classifyMtprotoError(new Error('FLOOD_WAIT_30')), null);
});

test('falha transitória ao conectar: tenta de novo e conecta, sem aviso', async () => {
  const { client, src, exceptions } = setup();
  client.connectErrors = [new Error('ECONNRESET'), new Error('ETIMEDOUT')];
  await src.start();
  assert.equal(client.connects, 3);
  assert.equal(src.status(), 'conectado');
  assert.ok(!exceptions.log.includes('open:desconectado'));
  await src.stop();
});

test('conexão caiu e passou do limite: aviso desconectado; voltou: resolve', async () => {
  const { client, src, exceptions } = setup({ disconnectAlertMs: 20 });
  await src.start();
  client.state('broken');
  assert.equal(src.status(), 'reconectando');
  await until(() => exceptions.log.includes('open:desconectado'));
  client.state('connected');
  assert.equal(src.status(), 'conectado');
  assert.ok(exceptions.log.includes('resolve:desconectado'));
  await src.stop();
});

test('sessão MTProto cifrada em disco: relê com a chave certa, falha com a errada, ausente = null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-session-'));
  const path = join(dir, 'tg.session.enc');
  const key = parseSessionKey(Buffer.alloc(32, 3).toString('base64'));
  const session = '1BQANOTEXAMPLESESSIONSTRING';
  await saveSession(path, key, session);
  assert.ok(!(await readFile(path, 'utf8')).includes(session), 'sem texto claro');
  assert.equal(await loadSession(path, key), session);
  await assert.rejects(loadSession(path, parseSessionKey(Buffer.alloc(32, 4).toString('base64'))));
  assert.equal(await loadSession(join(dir, 'nao-existe'), key), null);
  assert.throws(() => parseSessionKey('curta'), /32 bytes/);
});
