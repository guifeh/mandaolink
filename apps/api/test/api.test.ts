import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { connectDatabase } from '../src/db.js';
import { createPipelineStore } from '../src/pipeline-store.js';
import { createQueueStore } from '../src/queue-store.js';
import {
  runPipeline,
  nicheGate,
  renderMessage,
  validateMessage,
  resolve,
  sendingWindow,
  type PipelineInput,
  type PipelineConfig,
} from '@mandaolink/core';

// TEST_DATABASE_URL deve apontar exclusivamente para banco vazio e descartavel.
const embedded = process.env.TEST_DATABASE_URL ? undefined : new PGlite();
const localClient = {
  async query(sql: string, params?: unknown[]) {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }], rowCount: 1 };
    if (sql.includes('pg_advisory_')) return { rows: [], rowCount: 1 };
    if (!params && sql.includes('\n') && /^(CREATE|ALTER)/.test(sql)) {
      await embedded!.exec(sql);
      return { rows: [], rowCount: 0 };
    }
    const result = await embedded!.query(sql, params);
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
  },
  release() {},
};
const db = process.env.TEST_DATABASE_URL
  ? connectDatabase(process.env.TEST_DATABASE_URL)
  : ({
      query: localClient.query,
      connect: async () => localClient,
    } as unknown as Pool);
let capturedLink = '';
const app = await buildApp({
  db,
  ownerEmail: 'owner@example.test',
  appOrigin: 'http://localhost:3000',
  cookieSecure: false,
  sendMagicLink: async (_email, link) => {
    capturedLink = link;
  },
});
let session = '';
let sourceId: string, messageId: string, offerId: string, sendId: string;
const config = {
  nome: 'Carro',
  palavras_chave: ['carro'],
  palavras_bloqueadas: ['brinquedo'],
  categorias: [],
  tag_amazon: 'cliente-20',
  limite_hora: 5,
  limite_dia: 30,
  horario_inicio: '08:00',
  horario_fim: '22:00',
};
before(async () => {
  await migrate(db);
  await migrate(db);
});
after(async () => {
  await app.close();
  if (embedded) await embedded.close();
  else await db.end();
});

test('migra do zero, reaplica sem duplicar e comeca pausado', async () => {
  assert.ok((await db.query("SELECT 1 FROM schema_migrations WHERE nome='005_runtime.sql'")).rowCount);
  assert.equal((await db.query('SELECT pausado FROM config_nicho')).rows[0].pausado, true);
});
test('saude publica; endpoints privados exigem sessao', async () => {
  assert.equal((await app.inject('/saude')).statusCode, 200);
  for (const url of ['/config', '/historico', '/pendencias']) assert.equal((await app.inject(url)).statusCode, 401);
  assert.equal((await app.inject({ method: 'PUT', url: '/pausa', payload: { pausado: false } })).statusCode, 401);
});
test('e-mail nao autorizado recebe resposta neutra e nenhum token', async () => {
  const result = await app.inject({ method: 'POST', url: '/auth/link', payload: { email: 'other@example.test' } });
  assert.equal(result.statusCode, 202);
  assert.equal(capturedLink, '');
  assert.equal((await db.query('SELECT * FROM auth_links')).rowCount, 0);
});
test('link magico guarda hash, consome uma vez e cria cookie restrito', async () => {
  const requested = await app.inject({ method: 'POST', url: '/auth/link', payload: { email: 'owner@example.test' } });
  assert.equal(requested.statusCode, 202);
  const raw = new URL(capturedLink).hash.slice('#token='.length);
  assert.ok(raw.length === 64);
  assert.ok(!requested.body.includes(raw));
  assert.notEqual((await db.query('SELECT token_hash FROM auth_links')).rows[0].token_hash, raw);
  const verified = await app.inject({ method: 'POST', url: '/auth/verificar', payload: { token: raw } });
  assert.equal(verified.statusCode, 200);
  const header = String(verified.headers['set-cookie']);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/i);
  assert.doesNotMatch(header, /; Secure/);
  session = header.split(';')[0];
  assert.equal((await app.inject({ method: 'POST', url: '/auth/verificar', payload: { token: raw } })).statusCode, 401);
});
test('config persiste arrays, tag e limites e bloqueia corpo desconhecido/invalido', async () => {
  const headers = { cookie: session };
  assert.equal((await app.inject({ method: 'PUT', url: '/config', headers, payload: config })).statusCode, 200);
  const got = (await app.inject({ url: '/config', headers })).json();
  assert.deepEqual(got.palavras_chave, ['carro']);
  assert.equal(got.tag_amazon, 'cliente-20');
  for (const invalid of [
    { ...config, limite_hora: 40 },
    { ...config, horario_fim: '08:00' },
    { ...config, extra: true },
    { ...config, limite_hora: '5' },
  ]) {
    assert.equal((await app.inject({ method: 'PUT', url: '/config', headers, payload: invalid })).statusCode, 400);
  }
});
test('pausa persiste, rejeita origem externa e tipo incorreto', async () => {
  const headers = { cookie: session };
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: '/pausa',
        headers: { ...headers, origin: 'http://evil.test' },
        payload: { pausado: false },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ method: 'PUT', url: '/pausa', headers, payload: { pausado: 'false' } })).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: 'PUT', url: '/pausa', headers, payload: { pausado: false } })).json().pausado,
    false,
  );
  assert.equal((await app.inject({ url: '/config', headers })).json().pausado, false);
});
test('unicidade de ingestao e produto; fonte exige autorizacao para ativar', async () => {
  await assert.rejects(
    db.query(
      "INSERT INTO fontes(plataforma,identificador_externo,nome,ativa) VALUES ('telegram','nao-autorizada','Exemplo',true)",
    ),
  );
  sourceId = (
    await db.query(
      "INSERT INTO fontes(plataforma,identificador_externo,nome) VALUES ('telegram','sintetica','Exemplo sintetico') RETURNING id",
    )
  ).rows[0].id;
  messageId = (
    await db.query(
      "INSERT INTO mensagens_brutas(fonte_id,mensagem_externa_id,conteudo,publicada_em) VALUES ($1,'1','{}',now()) RETURNING id",
      [sourceId],
    )
  ).rows[0].id;
  await assert.rejects(
    db.query(
      "INSERT INTO mensagens_brutas(fonte_id,mensagem_externa_id,conteudo,publicada_em) VALUES ($1,'1','{}',now())",
      [sourceId],
    ),
  );
  offerId = (await db.query("INSERT INTO ofertas(loja,id_loja) VALUES ('amazon','B012345678') RETURNING id")).rows[0]
    .id;
  await assert.rejects(db.query("INSERT INTO ofertas(loja,id_loja) VALUES ('amazon','B012345678')"));
  await assert.rejects(db.query("INSERT INTO ofertas(loja,id_loja) VALUES ('amazon','invalido')"));
});
test('eventos antes do ASIN e logs imutaveis', async () => {
  await db.query(
    "INSERT INTO eventos_oferta(mensagem_bruta_id,gate,resultado,motivo) VALUES ($1,0,'REPROVA','fonte inativa')",
    [messageId],
  );
  await assert.rejects(db.query('UPDATE mensagens_brutas SET conteudo=$1 WHERE id=$2', ['{}', messageId]), /imutavel/);
  await assert.rejects(db.query('DELETE FROM eventos_oferta'), /imutavel/);
  await assert.rejects(
    db.query("INSERT INTO eventos_oferta(mensagem_bruta_id,gate,resultado,motivo) VALUES ($1,7,'ADIA','rede')", [
      messageId,
    ]),
  );
});
test('envio incerto nao volta a fila, bloqueia duplicado e pode ser reconciliado', async () => {
  const params = [offerId, messageId];
  sendId = (
    await db.query(
      "INSERT INTO envios(oferta_id,mensagem_bruta_id,destino_id,chave_idempotencia,texto,texto_hash,expira_em) VALUES ($1,$2,'teste','key1','Exemplo','hash',now()+interval '2 hours') RETURNING id",
      params,
    )
  ).rows[0].id;
  await db.query("UPDATE envios SET estado='incerto',incerto_em=now() WHERE id=$1", [sendId]);
  await assert.rejects(db.query("UPDATE envios SET estado='na_fila' WHERE id=$1", [sendId]), /transicao/);
  await assert.rejects(
    db.query(
      "INSERT INTO envios(oferta_id,mensagem_bruta_id,destino_id,chave_idempotencia,texto,texto_hash,expira_em) VALUES ($1,$2,'teste','key2','Exemplo','hash',now()+interval '2 hours')",
      params,
    ),
  );
  const pending = (await app.inject({ url: '/pendencias', headers: { cookie: session } })).json();
  assert.equal(pending.envios[0].estado, 'incerto');
  await assert.rejects(
    db.query("UPDATE envios SET estado='enviado',enviado_em=now(),mensagem_externa_id='eco1' WHERE id=$1", [sendId]),
    /snapshot/,
  );
  await db.query(
    "UPDATE envios SET estado='enviado',enviado_em=now(),mensagem_externa_id='eco1',preco_centavos=1000,preco_lido_em=now(),imagem_url='https://example.test/photo.jpg' WHERE id=$1",
    [sendId],
  );
  await assert.rejects(db.query("UPDATE envios SET estado='na_fila' WHERE id=$1", [sendId]));
});
test('historico paginado e pendencias incluem apenas excecoes abertas', async () => {
  await db.query("INSERT INTO excecoes(tipo,descricao,severidade) VALUES ('teste','Dado sintetico','amarelo')");
  await db.query(
    "INSERT INTO excecoes(tipo,descricao,severidade,resolvida_em) VALUES ('resolvida','Dado sintetico','amarelo',now())",
  );
  const headers = { cookie: session };
  const history = (await app.inject({ url: '/historico?limite=1&pagina=1', headers })).json();
  assert.equal(history.eventos.length, 1);
  assert.equal(history.envios[0].estado, 'enviado');
  assert.equal((await app.inject({ url: '/historico?limite=101', headers })).statusCode, 400);
  assert.equal((await app.inject({ url: '/pendencias', headers })).json().excecoes.length, 1);
});
test('token e sessao expirados sao rejeitados; logout revoga sessao', async () => {
  const digest = createHash('sha256').update('0'.repeat(64)).digest('hex');
  await db.query("INSERT INTO auth_links(token_hash,expira_em) VALUES ($1,now()-interval '1 second')", [digest]);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/auth/verificar', payload: { token: '0'.repeat(64) } })).statusCode,
    401,
  );
  assert.equal((await app.inject({ method: 'POST', url: '/auth/sair', headers: { cookie: session } })).statusCode, 204);
  assert.equal((await app.inject({ url: '/config', headers: { cookie: session } })).statusCode, 401);
  assert.equal((await db.query('SELECT * FROM auth_sessoes')).rowCount, 0);
  await db.query("INSERT INTO auth_sessoes(token_hash,expira_em) VALUES ($1,now()-interval '1 second')", [digest]);
  assert.equal((await app.inject({ url: '/config', headers: { cookie: `sessao=${'0'.repeat(64)}` } })).statusCode, 401);
});
test('login limita tentativas sem derrubar saude', async () => {
  let status = 0;
  for (let i = 0; i < 6; i++)
    status = (await app.inject({ method: 'POST', url: '/auth/link', payload: { email: 'other@example.test' } }))
      .statusCode;
  assert.equal(status, 429);
  assert.equal((await app.inject('/saude')).statusCode, 200);
});
test('saude retorna 503 sem vazar falha do banco', async () => {
  const unavailable = await buildApp({
    db: {
      query: async () => {
        throw new Error('credencial privada');
      },
    } as unknown as Pool,
    ownerEmail: 'owner@example.test',
    appOrigin: 'https://localhost',
  });
  try {
    const response = await unavailable.inject('/saude');
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { status: 'indisponivel' });
  } finally {
    await unavailable.close();
  }
});
test('event sink persiste antes/depois do ASIN sem perder preco historico de envio', async () => {
  const store = createPipelineStore(db, 'teste');
  const now = Date.now();
  await store.record({ mensagemId: messageId, gate: 0, criadoEm: now, resultado: { status: 'PASSA' } });
  await store.record({
    mensagemId: messageId,
    asin: 'B012345678',
    gate: 4,
    criadoEm: now,
    resultado: { status: 'PASSA' },
    produto: {
      asin: 'B012345678',
      pageAsin: 'B012345678',
      title: 'Novo preco oficial',
      priceCents: 2000,
      available: true,
      checkedAt: new Date(now).toISOString(),
      image: 'https://example.test/p.jpg',
    },
  });
  assert.equal((await store.lastSend('B012345678'))!.precoCentavos, 1000);
  assert.equal(
    Number((await db.query('SELECT preco_centavos FROM ofertas WHERE id=$1', [offerId])).rows[0].preco_centavos),
    2000,
  );
  await assert.rejects(
    store.record({
      mensagemId: '00000000-0000-0000-0000-000000000000',
      asin: 'B099999999',
      gate: 2,
      criadoEm: now,
      resultado: { status: 'PASSA' },
    }),
  );
  assert.equal((await db.query("SELECT 1 FROM ofertas WHERE id_loja='B099999999'")).rowCount, 0);
});
const queueNow = Date.parse('2026-11-23T12:00:00Z');
async function queueCandidate(asin: string, destination: string, now = queueNow) {
  await db.query('UPDATE fontes SET ativa=true,autorizada_em=now() WHERE id=$1', [sourceId]);
  await db.query(
    "UPDATE config_nicho SET pausado=false,palavras_chave=ARRAY['carro'],palavras_bloqueadas='{}',categorias='{}' WHERE id=1",
  );
  const text = `Exemplo sintetico https://www.amazon.com.br/dp/${asin}`;
  const m = (
    await db.query(
      `INSERT INTO mensagens_brutas(fonte_id,mensagem_externa_id,conteudo,publicada_em,recebida_em,preco_anunciado_centavos)
    VALUES ($1,$2,$3,$4,$4,1000) RETURNING id`,
      [sourceId, crypto.randomUUID(), JSON.stringify({ texto: text }), new Date(now)],
    )
  ).rows[0];
  const input: PipelineInput = {
    mensagemId: m.id,
    texto: text,
    fonte: { id: sourceId, ativa: true, autorizada: true },
    publicadaEm: now,
    recebidaEm: now,
    precoFonteCentavos: 1000,
  };
  const config: PipelineConfig = {
    fontesPermitidas: [sourceId],
    nicho: { palavras_chave: ['carro'], palavras_bloqueadas: [] },
    tagAmazon: 'cliente-20',
  };
  const outcome = await runPipeline(input, config, {
    ...createPipelineStore(db, destination),
    now: () => now,
    resolve,
    nicheGate,
    renderMessage,
    validateMessage,
    reader: {
      read: async () => ({
        ok: true,
        product: {
          asin,
          pageAsin: asin,
          title: 'Suporte para carro',
          priceCents: 1000,
          image: 'https://example.test/synthetic.jpg',
          available: true,
          checkedAt: new Date(now).toISOString(),
        },
      }),
    },
  });
  assert.equal(outcome.resultado.status, 'PASSA');
  return { input, config, outcome };
}
test('fila SQL deduplica produto/destino, reserva snapshot e persiste intervalo antes do ack', async () => {
  const store = createQueueStore(db);
  const candidate = await queueCandidate('B011111111', 'grupo-teste');
  const id = await store.enqueue(candidate.input, candidate.config, candidate.outcome, 'grupo-teste', queueNow);
  assert.ok(id);
  assert.equal(
    await store.enqueue(candidate.input, candidate.config, candidate.outcome, 'grupo-teste', queueNow),
    null,
  );
  const other = await store.enqueue(candidate.input, candidate.config, candidate.outcome, 'outro-grupo', queueNow);
  assert.ok(other);
  await store.discard(other, 'teste_sintetico');
  const item = (await store.next(queueNow))!;
  assert.equal(item.id, id);
  assert.equal(item.input.precoFonteCentavos, 1000);
  assert.equal(await store.claim(item, candidate.outcome, queueNow, queueNow + 180000), true);
  assert.equal(await store.claim(item, candidate.outcome, queueNow, queueNow + 180000), false);
  const state = await store.state(queueNow);
  assert.equal(state.contagemHora, 1);
  assert.equal(state.contagemDia, 1);
  assert.equal(state.proximoEm, queueNow + 180000);
  await store.uncertain(id, 'ack ainda nao chegou');
  assert.equal((await db.query('SELECT estado FROM envios WHERE id=$1', [id])).rows[0].estado, 'incerto');
  await store.confirmed(id, 'ack-sintetico', queueNow + 1000);
  assert.equal((await db.query('SELECT estado FROM envios WHERE id=$1', [id])).rows[0].estado, 'enviado');
  await store.confirmed(id, 'ack-posterior-ao-eco', queueNow + 2000);
  const reconciled = (await db.query('SELECT mensagem_externa_id,enviado_em FROM envios WHERE id=$1', [id])).rows[0];
  assert.equal(reconciled.mensagem_externa_id, 'ack-sintetico');
  assert.equal(new Date(reconciled.enviado_em).getTime(), queueNow + 1000);
  await assert.rejects(store.confirmed('00000000-0000-0000-0000-000000000000', 'ack-invalido', queueNow), /reserva/);
  await assert.rejects(db.query('UPDATE envios SET preco_centavos=1 WHERE id=$1', [id]), /imutavel/);
  const nextMessage = await queueCandidate('B022222222', 'grupo-teste');
  assert.ok(await store.enqueue(nextMessage.input, nextMessage.config, nextMessage.outcome, 'grupo-teste', queueNow));
});
test('fila SQL expira com motivo terminal e evento G9, preserva registros imutaveis', async () => {
  const store = createQueueStore(db);
  await store.expire(queueNow + 121 * 60000);
  const discarded = await db.query(
    "SELECT motivo_descarte FROM envios WHERE estado='descartado' AND motivo_descarte='vencida_na_fila'",
  );
  assert.equal(discarded.rowCount, 1);
  assert.ok((await db.query("SELECT 1 FROM eventos_oferta WHERE gate=9 AND motivo='vencida na fila'")).rowCount);
  await assert.rejects(db.query("UPDATE envios SET estado='na_fila' WHERE estado='descartado'"), /transicao/);
  await assert.rejects(
    db.query(
      "INSERT INTO mensagens_brutas(fonte_id,mensagem_externa_id,conteudo,publicada_em) VALUES ($1,'pii',$2,now())",
      [sourceId, JSON.stringify({ texto: 'Exemplo', telefone: 'dado sintético' })],
    ),
  );
});
test('fila SQL conta hora movel e dia civil de Sao Paulo', async () => {
  const store = createQueueStore(db);
  assert.equal((await store.state(queueNow + 3600000)).contagemHora, 0);
  assert.equal((await store.state(Date.parse('2026-11-24T02:59:59Z'))).contagemDia, 1);
  assert.equal((await store.state(Date.parse('2026-11-24T03:00:00Z'))).contagemDia, 0);
});
test('fila SQL pausa e fonte desativada bloqueiam reserva', async () => {
  const store = createQueueStore(db);
  const c = await queueCandidate('B033333333', 'grupo-teste');
  const id = await store.enqueue(c.input, c.config, c.outcome, 'grupo-teste', queueNow);
  const item = (await store.next(queueNow))!;
  assert.equal(item.id, id);
  await db.query('UPDATE config_nicho SET pausado=true WHERE id=1');
  assert.equal(await store.claim(item, c.outcome, queueNow, queueNow + 180000), false);
  await db.query('UPDATE config_nicho SET pausado=false WHERE id=1');
  await db.query('UPDATE fontes SET ativa=false WHERE id=$1', [sourceId]);
  assert.equal(await store.claim(item, c.outcome, queueNow, queueNow + 180000), false);
  await store.discard(id!, 'fonte_inativa');
});
test('incerto generico nao vira falhou; prova pre-transmissao atomica libera falha auditada', async () => {
  const store = createQueueStore(db);
  const c = await queueCandidate('B044444444', 'grupo-teste');
  const id = (await store.enqueue(c.input, c.config, c.outcome, 'grupo-teste', queueNow))!;
  const item = (await store.next(queueNow))!;
  assert.equal(await store.claim(item, c.outcome, queueNow, queueNow + 180000), true);
  await assert.rejects(db.query("UPDATE envios SET estado='falhou',erro='timeout' WHERE id=$1", [id]), /transicao/);
  await assert.rejects(
    db.query("UPDATE envios SET estado='falhou',falha_pre_transmissao=true,erro='sem sessao' WHERE id=$1", [id]),
    /prova/,
  );
  await store.notTransmitted(id, 'sem sessao antes de iniciar transmissao');
  const row = (await db.query('SELECT estado,falha_pre_transmissao FROM envios WHERE id=$1', [id])).rows[0];
  assert.equal(row.estado, 'falhou');
  assert.equal(row.falha_pre_transmissao, true);
  const proof = (await db.query('SELECT prova_pre_transmissao FROM eventos_oferta WHERE envio_id=$1', [id])).rows[0];
  assert.equal(proof.prova_pre_transmissao.naoTransmitido, true);
});
test('APP_ORIGIN define link/origem aceita e COOKIE_SECURE ativa cookie HTTPS', async () => {
  let link = '';
  const secure = await buildApp({
    db,
    ownerEmail: 'owner@example.test',
    appOrigin: 'https://painel.example.test',
    cookieSecure: true,
    sendMagicLink: async (_email, value) => {
      link = value;
    },
  });
  try {
    assert.equal(
      (
        await secure.inject({
          method: 'POST',
          url: '/auth/link',
          headers: { origin: 'https://painel.example.test' },
          payload: { email: 'owner@example.test' },
        })
      ).statusCode,
      202,
    );
    assert.equal(new URL(link).origin, 'https://painel.example.test');
    const raw = new URL(link).hash.slice('#token='.length);
    assert.equal(
      (
        await secure.inject({
          method: 'POST',
          url: '/auth/verificar',
          headers: { origin: 'https://outro.example.test' },
          payload: { token: raw },
        })
      ).statusCode,
      403,
    );
    const response = await secure.inject({
      method: 'POST',
      url: '/auth/verificar',
      headers: { origin: 'https://painel.example.test' },
      payload: { token: raw },
    });
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['set-cookie']), /; Secure/);
  } finally {
    await secure.close();
  }
});

test('operacao autenticada mostra pausa, historico paginado e pareamento simulado', async () => {
  const token = 'e'.repeat(64);
  await db.query("INSERT INTO auth_sessoes(token_hash,expira_em) VALUES ($1,now()+interval '1 hour')", [
    createHash('sha256').update(token).digest('hex'),
  ]);
  const headers = { cookie: `sessao=${token}` };
  await db.query('UPDATE config_nicho SET pausado=true WHERE id=1');
  const state = (await app.inject({ url: '/operacao', headers })).json();
  assert.equal(state.semaforo, 'vermelho');
  assert.equal(state.pausado, true);
  const history = await app.inject({ url: '/operacao/historico?pagina=1', headers });
  assert.equal(history.statusCode, 200);
  assert.ok(history.json().envios.every((row: { estado: string }) => ['enviado', 'descartado'].includes(row.estado)));
  assert.equal((await app.inject({ url: '/operacao/historico?pagina=0', headers })).statusCode, 400);
  const pair = (await app.inject({ url: '/pareamento', headers })).json();
  assert.equal(pair.simulado, true);
  assert.match(pair.qr, /^data:image\/png;base64,/);
  assert.equal((await app.inject('/pareamento')).statusCode, 401);
  const push = (await app.inject({ url: '/push/config', headers })).json();
  assert.equal(typeof push.publicKey, 'string');
  assert.equal(push.privateKey, undefined);
  assert.equal(push.simulado, true);
  const invalid = { endpoint: 'https://127.0.0.1/private', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } };
  assert.equal(
    (await app.inject({ method: 'POST', url: '/push/assinatura', headers, payload: invalid })).statusCode,
    400,
  );
});

test('config aceita janela noturna, rejeita horarios iguais e preserva limites', async () => {
  const token = '8'.repeat(64);
  await db.query("INSERT INTO auth_sessoes(token_hash,expira_em) VALUES ($1,now()+interval '1 hour')", [
    createHash('sha256').update(token).digest('hex'),
  ]);
  const headers = { cookie: `sessao=${token}` };
  try {
    const response = await app.inject({
      method: 'PUT',
      url: '/config',
      headers,
      payload: { ...config, horario_inicio: '18:00', horario_fim: '02:00' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().horario_inicio.slice(0, 5), '18:00');
    assert.equal(response.json().horario_fim.slice(0, 5), '02:00');
    const equal = await app.inject({
      method: 'PUT',
      url: '/config',
      headers,
      payload: { ...config, horario_fim: '08:00' },
    });
    assert.equal(equal.statusCode, 400);
    assert.equal(equal.json().erro, 'Os horários de início e término devem ser diferentes.');
    const limits = await app.inject({
      method: 'PUT',
      url: '/config',
      headers,
      payload: { ...config, limite_hora: 40 },
    });
    assert.equal(limits.statusCode, 400);
    assert.equal(limits.json().erro, 'O limite por hora não pode ser maior que o limite diário.');
    await assert.rejects(
      db.query("UPDATE config_nicho SET horario_inicio='02:00',horario_fim='02:00' WHERE id=1"),
      /check/i,
    );
  } finally {
    await db.query("UPDATE config_nicho SET horario_inicio='08:00',horario_fim='22:00' WHERE id=1");
  }
});

test('janela 18–02 atravessa meia-noite mas a cota SQL reinicia por dia civil de Sao Paulo', async () => {
  const beforeMidnight = Date.parse('2026-11-25T02:59:00Z');
  const midnight = Date.parse('2026-11-25T03:00:00Z');
  const store = createQueueStore(db);
  try {
    await db.query("UPDATE config_nicho SET horario_inicio='18:00',horario_fim='02:00' WHERE id=1");
    const candidate = await queueCandidate('B099887766', 'grupo-noturno', beforeMidnight);
    const id = await store.enqueue(
      candidate.input,
      candidate.config,
      candidate.outcome,
      'grupo-noturno',
      beforeMidnight,
    );
    assert.ok(id);
    const item = (await store.next(beforeMidnight))!;
    assert.equal(item.id, id);
    assert.equal(await store.claim(item, candidate.outcome, beforeMidnight, beforeMidnight + 180000), true);
    assert.equal((await store.state(beforeMidnight)).contagemDia, 1);
    const after = await store.state(midnight);
    assert.equal(after.contagemDia, 0);
    assert.equal(after.contagemHora, 1);
    assert.equal(after.proximoEm, beforeMidnight + 180000);
    assert.equal(after.fuso, 'America/Sao_Paulo');
    assert.equal(sendingWindow(beforeMidnight, after.horarioInicio, after.horarioFim, after.fuso), true);
    assert.equal(sendingWindow(midnight, after.horarioInicio, after.horarioFim, after.fuso), true);
  } finally {
    await db.query("UPDATE config_nicho SET horario_inicio='08:00',horario_fim='22:00' WHERE id=1");
  }
});
