// Testes com socket mockado. Nenhum número é pareado ou conectado.
// IDs de grupo e textos são dados de exemplo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backoffMs, createWhatsAppConnector, textHash, type ConnectorOptions } from '../src/connector.ts';
import { createWhatsAppPublisher } from '../src/publisher.ts';
import { parseAuthKey, useEncryptedFileAuthState } from '../src/auth-state.ts';
import type { AuthBundle, ExceptionSink, SourceMessage, WaSocket } from '../src/types.ts';

type KeyStore = {
  get(type: string, ids: string[]): Promise<Record<string, { public: Uint8Array }>>;
  set(data: Record<string, Record<string, unknown>>): Promise<void>;
};

const CLIENTE = '120363000000000001@g.us';
const FONTE = '120363000000000002@g.us';
const ME = '5511900000000:7@s.whatsapp.net';

class FakeSocket implements WaSocket {
  private bus = new EventEmitter().setMaxListeners(50);
  ev = {
    on: (event: string, handler: (arg: never) => void) => {
      this.bus.on(event, handler as (arg: unknown) => void);
    },
  };
  ws = { isOpen: true };
  user = { id: ME, lid: '99999999999:7@lid' };
  calls: string[] = [];
  sent: { jid: string; content: Record<string, unknown> }[] = [];
  groups: Record<string, { id: string; subject: string; participants: unknown[] }> = {
    [CLIENTE]: { id: CLIENTE, subject: 'Cliente', participants: [{}, {}] },
    [FONTE]: { id: FONTE, subject: 'Fonte', participants: [{}] },
  };
  sendImpl: (jid: string, content: Record<string, unknown>) => Promise<{ key?: { id?: string | null } } | undefined> =
    async () => ({ key: { id: 'WAMSG1' } });
  ended = false;
  emit(event: string, arg: unknown) {
    this.bus.emit(event, arg);
  }
  async sendMessage(jid: string, content: Record<string, unknown>) {
    this.calls.push('sendMessage');
    this.sent.push({ jid, content });
    return this.sendImpl(jid, content);
  }
  async sendPresenceUpdate(type: string) {
    this.calls.push(`presence:${type}`);
  }
  async groupFetchAllParticipating() {
    return this.groups;
  }
  async requestPairingCode(phone: string) {
    this.calls.push(`pair:${phone}`);
    return 'ABCD1234';
  }
  end() {
    this.ended = true;
  }
}
// O conector usa sock.ev.on; o EventEmitter já tem on/emit.

function sink() {
  const log: string[] = [];
  const s: ExceptionSink & { log: string[] } = {
    log,
    async open(e) {
      log.push(`open:${e.tipo}:${e.severidade}:${e.grupoExternoId ?? '-'}`);
    },
    async resolve(t, g) {
      log.push(`resolve:${t}:${g ?? '-'}`);
    },
  };
  return s;
}

const memAuth = (registered = true): AuthBundle => ({
  state: { creds: { registered }, keys: {} },
  saveCreds: async () => {},
});
const tick = () => new Promise((r) => setImmediate(r));

async function setup(over: Partial<ConnectorOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const exceptions = sink();
  let paused = false;
  const c = createWhatsAppConnector({
    auth: async () => memAuth(),
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    destinos: [CLIENTE],
    fontes: [FONTE],
    exceptions,
    isPaused: () => paused,
    random: () => 0,
    sleep: async (_ms, signal) => {
      if (signal?.aborted) throw signal.reason;
    },
    ...over,
  });
  await c.connect();
  const sock = () => sockets.at(-1)!;
  const openConn = async () => {
    sock().emit('connection.update', { connection: 'open' });
    await tick();
  };
  return { c, sockets, sock, exceptions, openConn, setPaused: (v: boolean) => (paused = v) };
}

const close = (code: number) => ({ connection: 'close', lastDisconnect: { error: { output: { statusCode: code } } } });

test('envio ok: "digitando" antes, sendMessage com imagem e legenda, retorna o id do WhatsApp', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  const r = await c.sendToGroup(CLIENTE, { texto: 'Oferta X', mediaUrl: 'https://m.media-amazon.com/x.jpg' }, 'k1');
  assert.deepEqual(r, { status: 'enviado', mensagemId: 'WAMSG1' });
  assert.deepEqual(sock().calls.slice(0, 2), ['presence:composing', 'sendMessage']);
  assert.deepEqual(sock().sent[0], {
    jid: CLIENTE,
    content: { image: { url: 'https://m.media-amazon.com/x.jpg' }, caption: 'Oferta X' },
  });
});

test('mesma chave de idempotência no processo: um envio só', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  const [a, b] = await Promise.all([
    c.sendToGroup(CLIENTE, { texto: 'T', mediaUrl: null }, 'k-dup'),
    c.sendToGroup(CLIENTE, { texto: 'T', mediaUrl: null }, 'k-dup'),
  ]);
  assert.deepEqual(a, b);
  assert.equal(sock().sent.length, 1);
});

test('número único: nunca escreve em grupo-fonte nem fora da allowlist', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  for (const g of [FONTE, '120363000000000099@g.us', '5511988887777@s.whatsapp.net']) {
    const r = await c.sendToGroup(g, { texto: 'T', mediaUrl: null }, `k-${g}`);
    assert.deepEqual(r, { status: 'nao_transmitido', motivo: 'destino_nao_permitido' });
  }
  assert.equal(sock().calls.length, 0, 'nada chegou ao socket, nem presença');
});

test('allowlist que contém uma fonte é recusada na conexão', async () => {
  await assert.rejects(setup({ destinos: [FONTE] }), /também é fonte/);
  assert.throws(
    () => createWhatsAppConnector({ ...({} as ConnectorOptions), destinos: ['5511988887777@s.whatsapp.net'] }),
    /grupo/,
  );
});

test('queda ANTES de transmitir: falhou + naoTransmitido; sendMessage não é chamado', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  const pub = createWhatsAppPublisher(c);
  sock().emit('connection.update', close(408));
  await tick();
  const r = await pub.send(
    { destinoId: CLIENTE, texto: 'T', mediaUrl: null, idempotencyKey: 'k2' },
    AbortSignal.timeout(1000),
  );
  assert.deepEqual(r, { status: 'falhou', naoTransmitido: true, motivo: 'socket_fechado' });
  assert.equal(sock().sent.length, 0);
  await c.stop();
});

test('socket caiu durante o "digitando": ainda não transmitido', async () => {
  const { c, sock, openConn } = await setup({
    sleep: async () => {
      sock().ws.isOpen = false;
    },
  });
  await openConn();
  const r = await c.sendToGroup(CLIENTE, { texto: 'T', mediaUrl: null }, 'k3');
  assert.deepEqual(r, { status: 'nao_transmitido', motivo: 'socket_fechado' });
  assert.equal(sock().sent.length, 0);
});

test('queda DURANTE a transmissão: incerto (nunca falhou), no publisher também', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  sock().sendImpl = async () => {
    throw new Error('Connection Closed');
  };
  const pub = createWhatsAppPublisher(c);
  const r = await pub.send(
    { destinoId: CLIENTE, texto: 'T', mediaUrl: null, idempotencyKey: 'k4' },
    AbortSignal.timeout(1000),
  );
  assert.equal(r.status, 'incerto');
  assert.match((r as { motivo: string }).motivo, /erro_durante_envio/);
});

test('timeout durante a transmissão: incerto', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  sock().sendImpl = () => new Promise(() => {});
  const r = await c.sendToGroup(CLIENTE, { texto: 'T', mediaUrl: null }, 'k5', AbortSignal.timeout(50));
  assert.deepEqual(r, { status: 'incerto', motivo: 'timeout_durante_envio' });
});

test('ack sem id: incerto', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  sock().sendImpl = async () => ({ key: {} });
  assert.deepEqual(await c.sendToGroup(CLIENTE, { texto: 'T', mediaUrl: null }, 'k6'), {
    status: 'incerto',
    motivo: 'ack_sem_id',
  });
});

test('pausa geral: não envia, antes e depois do "digitando"', async () => {
  const ctx = await setup();
  await ctx.openConn();
  ctx.setPaused(true);
  assert.deepEqual(await ctx.c.sendToGroup(CLIENTE, { texto: 'T', mediaUrl: null }, 'k7'), {
    status: 'nao_transmitido',
    motivo: 'pausado',
  });

  const ctx2 = await setup({ sleep: async () => void ctx2.setPaused(true) });
  await ctx2.openConn();
  assert.deepEqual(await ctx2.c.sendToGroup(CLIENTE, { texto: 'T', mediaUrl: null }, 'k8'), {
    status: 'nao_transmitido',
    motivo: 'pausado',
  });
  assert.equal(ctx2.sock().sent.length, 0);
});

test('eco: mensagem nossa no grupo do cliente vira EchoMessage com o hash do texto; não vira fonte', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  const echoes: unknown[] = [];
  const sources: unknown[] = [];
  c.onEcho((e) => echoes.push(e));
  c.onMessage((m) => sources.push(m));
  sock().emit('messages.upsert', {
    type: 'append',
    messages: [
      {
        key: { remoteJid: CLIENTE, id: 'WAMSG1', fromMe: true },
        messageTimestamp: 1795000000,
        message: { imageMessage: { caption: 'Oferta X' } },
      },
    ],
  });
  assert.deepEqual(echoes, [
    { grupoExternoId: CLIENTE, mensagemExternaId: 'WAMSG1', textoHash: textHash('Oferta X'), em: 1795000000000 },
  ]);
  assert.equal(sources.length, 0);
});

test('mensagem de fonte: entrega texto e ids, sem remetente; ignora histórico, privado e grupo do cliente', async () => {
  const { c, sock, openConn } = await setup();
  await openConn();
  const got: SourceMessage[] = [];
  c.onMessage((m) => got.push(m));
  const msg = (jid: string, id: string) => ({
    key: { remoteJid: jid, id, fromMe: false, participant: '5511977776666@s.whatsapp.net' },
    pushName: 'Fulano',
    messageTimestamp: 1795000000,
    message: { conversation: 'Oferta https://amzn.to/x' },
  });
  sock().emit('messages.upsert', {
    type: 'notify',
    messages: [msg(FONTE, 'A1'), msg(CLIENTE, 'A2'), msg('5511977776666@s.whatsapp.net', 'A3')],
  });
  sock().emit('messages.upsert', { type: 'append', messages: [msg(FONTE, 'A4')] });
  assert.deepEqual(got, [
    {
      plataforma: 'whatsapp',
      grupoExternoId: FONTE,
      mensagemExternaId: 'A1',
      texto: 'Oferta https://amzn.to/x',
      publicadaEm: 1795000000000,
    },
  ]);
  assert.ok(!JSON.stringify(got).includes('Fulano') && !JSON.stringify(got).includes('5511977776666'));
});

test('reconexão: queda comum reconecta com backoff SEM aviso; volta antes de 10 min, nada aparece', async () => {
  const { c, sockets, sock, exceptions, openConn } = await setup();
  await openConn();
  sock().emit('connection.update', close(408));
  await tick();
  assert.equal(c.status(), 'reconectando');
  await new Promise((r) => setTimeout(r, backoffMs(0, () => 0) + 50)); // 500 ms
  assert.equal(sockets.length, 2, 'criou socket novo');
  assert.ok(!exceptions.log.some((l) => l.startsWith('open:desconectado')), 'sem aviso antes de 10 min');
  await openConn();
  assert.equal(c.status(), 'conectado');
  assert.ok(exceptions.log.includes('resolve:desconectado:-'));
  // Eventos do socket antigo são ignorados.
  sockets[0].emit('connection.update', close(408));
  await tick();
  assert.equal(c.status(), 'conectado');
  await c.stop();
});

test('queda que passa do limite (10 min em produção) vira aviso "desconectado"; resolve ao voltar', async () => {
  const { c, sockets, exceptions, openConn } = await setup({ disconnectAlertMs: 100 });
  await openConn();
  sockets[0].emit('connection.update', close(408));
  await new Promise((r) => setTimeout(r, 150));
  assert.ok(exceptions.log.includes('open:desconectado:vermelho:-'));
  await new Promise((r) => setTimeout(r, 500));
  await openConn();
  assert.ok(exceptions.log.includes('resolve:desconectado:-'));
  await c.stop();
});

test('restartRequired (515, normal após parear) reconecta sem abrir exceção', async () => {
  const { c, sockets, sock, exceptions } = await setup();
  sock().emit('connection.update', close(515));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sockets.length, 2);
  assert.ok(!exceptions.log.some((l) => l.startsWith('open:')));
  await c.stop();
});

test('sessão invalidada (401, 440, 500) vs número bloqueado (403): avisos distintos e NÃO reconecta', async () => {
  for (const [code, tipo, status] of [
    [401, 'sessao_invalidada', 'sessao_invalida'],
    [440, 'sessao_invalidada', 'sessao_invalida'],
    [500, 'sessao_invalidada', 'sessao_invalida'],
    [403, 'numero_bloqueado', 'numero_bloqueado'],
  ] as const) {
    const { c, sockets, sock, exceptions, openConn } = await setup({ disconnectAlertMs: 50 });
    await openConn();
    sock().emit('connection.update', close(code));
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(c.status(), status);
    assert.equal(sockets.length, 1, `não reconectou (${code})`);
    assert.deepEqual(
      exceptions.log.filter((l) => l.startsWith('open:')),
      [`open:${tipo}:vermelho:-`],
      `só o aviso certo (${code})`,
    );
  }
});

test('removido do grupo: evento ao vivo (por LID) e conferência ao reconectar', async () => {
  const { sock, exceptions, openConn } = await setup();
  await openConn();
  assert.ok(exceptions.log.includes(`resolve:removido_do_grupo:${FONTE}`), 'presente na conferência inicial');
  sock().emit('group-participants.update', {
    id: FONTE,
    author: 'x',
    action: 'remove',
    participants: [{ id: '99999999999@lid' }],
  });
  sock().emit('group-participants.update', {
    id: CLIENTE,
    author: 'x',
    action: 'remove',
    participants: [{ id: '5511955554444@s.whatsapp.net' }],
  });
  await tick();
  assert.ok(exceptions.log.includes(`open:removido_do_grupo:amarelo:${FONTE}`));
  assert.ok(
    !exceptions.log.includes(`open:removido_do_grupo:vermelho:${CLIENTE}`),
    'remoção de outra pessoa não conta',
  );

  // Removido enquanto estava offline: o grupo do cliente some da lista ao reconectar.
  delete sock().groups[CLIENTE];
  await openConn();
  assert.ok(exceptions.log.includes(`open:removido_do_grupo:vermelho:${CLIENTE}`));
});

test('onStatus: avisa cada mudança de estado e cada QR novo; unsubscribe para de avisar', async () => {
  const { c, sock, openConn } = await setup();
  const seen: unknown[] = [];
  const off = c.onStatus((e) => seen.push(e));
  sock().emit('connection.update', { qr: 'QR-1' });
  sock().emit('connection.update', { qr: 'QR-2' });
  await openConn();
  sock().emit('connection.update', close(401));
  await tick();
  assert.deepEqual(seen, [
    { estado: 'aguardando_pareamento', qr: 'QR-1' },
    { estado: 'aguardando_pareamento', qr: 'QR-2' },
    { estado: 'conectado' },
    { estado: 'sessao_invalida' },
  ]);
  off();
  await c.stop();
  assert.equal(seen.length, 4, 'sem aviso depois do unsubscribe');
});

test('pareamento por código espera o socket ficar pronto (1º QR) e só manda dígitos', async () => {
  const sockets: FakeSocket[] = [];
  const c = createWhatsAppConnector({
    auth: async () => memAuth(false),
    socketFactory: () => (sockets.push(new FakeSocket()), sockets.at(-1)!),
    destinos: [CLIENTE],
    fontes: [],
    exceptions: sink(),
    isPaused: () => false,
  });
  await c.connect();
  const p = c.pairByCode('+55 (11) 90000-0000');
  sockets[0].emit('connection.update', { qr: 'QR-1' });
  assert.equal(await p, 'ABCD1234');
  assert.deepEqual(sockets[0].calls, ['pair:5511900000000']);
  const q = c.pairByQR();
  sockets[0].emit('connection.update', { qr: 'QR-2' });
  assert.equal(await q, 'QR-2');
  await assert.rejects(c.pairByCode('123'), /telefone_invalido/);
});

test('backoff: cresce, tem teto de 5 min e jitter', () => {
  assert.equal(
    backoffMs(0, () => 1),
    1000,
  );
  assert.equal(
    backoffMs(3, () => 1),
    8000,
  );
  assert.equal(
    backoffMs(30, () => 1),
    300_000,
  );
  assert.equal(
    backoffMs(3, () => 0),
    4000,
  );
});

test('auth cifrado: grava sem texto claro, relê com a chave certa e falha com a errada', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wa-auth-'));
  const key = parseAuthKey(Buffer.alloc(32, 7).toString('base64'));
  const a = await useEncryptedFileAuthState(dir, key);
  const regId = (a.state.creds as { registrationId: number }).registrationId;
  await a.saveCreds();
  await (a.state.keys as KeyStore).set({
    'pre-key': { '1': { public: Buffer.from('segredo-teste'), private: Buffer.alloc(32, 1) } },
  });
  const files = await readdir(dir);
  assert.ok(files.includes('creds.json.enc') && files.some((f) => f.startsWith('pre-key-1')));
  assert.ok(!files.some((f) => f.endsWith('.tmp')), 'gravação atômica não deixa temporário');
  const raw = await readFile(join(dir, 'creds.json.enc'), 'utf8');
  assert.ok(!raw.includes('registrationId') && !raw.includes('noiseKey'));

  const b = await useEncryptedFileAuthState(dir, key);
  assert.equal((b.state.creds as { registrationId: number }).registrationId, regId);
  const k = await (b.state.keys as KeyStore).get('pre-key', ['1']);
  assert.equal(Buffer.from(k['1'].public).toString(), 'segredo-teste');

  await assert.rejects(useEncryptedFileAuthState(dir, parseAuthKey(Buffer.alloc(32, 8).toString('base64'))));
  // Arquivo trocado de nome (AAD) também falha.
  await writeFile(
    join(dir, 'creds.json.enc'),
    await readFile(
      join(
        dir,
        files.find((f) => f.startsWith('pre-key-1'))!,
      ),
      'utf8',
    ),
  );
  await assert.rejects(useEncryptedFileAuthState(dir, key));
  assert.throws(() => parseAuthKey('curta'), /32 bytes/);
});
