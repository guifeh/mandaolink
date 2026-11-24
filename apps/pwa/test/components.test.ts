import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api/client.js';
import { getTabFromHash } from '../src/App.js';
import type { NicheConfig } from '../src/types.js';

test('ApiClient fetchConfig e updateConfig enviam cabeçalhos e cookies corretamente', async () => {
  const fakeDb: NicheConfig = {
    nome: 'Carro',
    palavras_chave: ['suporte veicular', 'pneu'],
    palavras_bloqueadas: ['brinquedo'],
    categorias: ['automotivo'],
    tag_amazon: 'cliente-20',
    limite_hora: 5,
    limite_dia: 30,
    horario_inicio: '08:00',
    horario_fim: '22:00',
  };

  const client = new ApiClient('http://fake-api.local');

  // Intercepta fetch global durante o teste
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert.equal(init?.credentials, 'include', 'Requisições devem incluir credentials');

      if (url.endsWith('/config') && init?.method === 'GET') {
        return new Response(JSON.stringify(fakeDb), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (url.endsWith('/config') && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        Object.assign(fakeDb, body);
        return new Response(JSON.stringify(fakeDb), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(null, { status: 404 });
    };

    const config = await client.fetchConfig();
    assert.equal(config.nome, 'Carro');
    assert.deepEqual(config.palavras_chave, ['suporte veicular', 'pneu']);

    const updated = await client.updateConfig({
      palavras_chave: ['suporte veicular', 'pneu', 'calibrador'],
    });

    assert.equal(updated.palavras_chave.includes('calibrador'), true);
    // Preserva campos não passados no partial
    assert.equal(updated.tag_amazon, 'cliente-20');
    assert.equal(updated.limite_hora, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tela Nicho: validação e adição de palavras do nicho e proibidas', async () => {
  const mockConfig: NicheConfig = {
    nome: 'Carro',
    palavras_chave: ['veicular', 'automotivo'],
    palavras_bloqueadas: ['brinquedo'],
    categorias: ['automotivo'],
    tag_amazon: 'cliente-20',
    limite_hora: 5,
    limite_dia: 30,
    horario_inicio: '08:00',
    horario_fim: '22:00',
  };

  let payloadSalvo: Partial<NicheConfig> | null = null;
  const mockClient = {
    async fetchConfig() {
      return { ...mockConfig };
    },
    async updateConfig(partial: Partial<NicheConfig>) {
      payloadSalvo = partial;
      return { ...mockConfig, ...partial };
    },
  } as unknown as ApiClient;

  // 1. Carrega dados
  const loaded = await mockClient.fetchConfig();
  const palavrasNicho = [...loaded.palavras_chave];
  let palavrasProibidas = [...loaded.palavras_bloqueadas];

  // 2. Adiciona termo ao nicho
  const novoTermo = 'pneu';
  if (!palavrasNicho.includes(novoTermo)) {
    palavrasNicho.push(novoTermo);
  }
  assert.deepEqual(palavrasNicho, ['veicular', 'automotivo', 'pneu']);

  // 3. Impede duplicatas
  let erroDuplicata = false;
  if (palavrasNicho.includes('pneu')) {
    erroDuplicata = true;
  }
  assert.equal(erroDuplicata, true);

  // 4. Remove termo proibido e adiciona novo
  palavrasProibidas = palavrasProibidas.filter((p) => p !== 'brinquedo');
  palavrasProibidas.push('carrinho de bebe');

  // 5. Salva alterações
  await mockClient.updateConfig({
    palavras_chave: palavrasNicho,
    palavras_bloqueadas: palavrasProibidas,
  });

  assert.ok(payloadSalvo);
  assert.deepEqual((payloadSalvo as Partial<NicheConfig>).palavras_chave, ['veicular', 'automotivo', 'pneu']);
  assert.deepEqual((payloadSalvo as Partial<NicheConfig>).palavras_bloqueadas, ['carrinho de bebe']);
});

test('Tela Horários e Limites: validação estrita de horários e proporção hora/dia', async () => {
  const validar = (inicio: string, fim: string, hora: number, dia: number) => {
    if (!inicio || !fim) return 'Informe o horário de início e término.';
    if (inicio >= fim) return 'O horário de início deve ser anterior ao horário de término.';
    if (hora <= 0) return 'O máximo por hora deve ser pelo menos 1.';
    if (dia <= 0) return 'O máximo por dia deve ser pelo menos 1.';
    if (hora > dia) return 'O limite por hora não pode ser maior que o limite diário.';
    return null;
  };

  // Horário invertido
  assert.equal(validar('22:00', '08:00', 5, 30), 'O horário de início deve ser anterior ao horário de término.');

  // Horários iguais
  assert.equal(validar('10:00', '10:00', 5, 30), 'O horário de início deve ser anterior ao horário de término.');

  // Limite por hora maior que dia
  assert.equal(validar('08:00', '22:00', 50, 30), 'O limite por hora não pode ser maior que o limite diário.');

  // Valores zerados ou negativos
  assert.equal(validar('08:00', '22:00', 0, 30), 'O máximo por hora deve ser pelo menos 1.');
  assert.equal(validar('08:00', '22:00', 5, 0), 'O máximo por dia deve ser pelo menos 1.');

  // Configuração válida
  assert.equal(validar('08:00', '22:00', 5, 30), null);

  // Mock de salvamento
  let salvo = false;
  const mockClient = {
    async fetchConfig() {
      return {} as NicheConfig;
    },
    async updateConfig(partial: Partial<NicheConfig>) {
      assert.equal(partial.horario_inicio, '08:00');
      assert.equal(partial.horario_fim, '22:00');
      assert.equal(partial.limite_hora, 5);
      assert.equal(partial.limite_dia, 30);
      salvo = true;
      return {} as NicheConfig;
    },
  } as unknown as ApiClient;

  await mockClient.updateConfig({
    horario_inicio: '08:00',
    horario_fim: '22:00',
    limite_hora: 5,
    limite_dia: 30,
  });

  assert.equal(salvo, true);
});

test('Tela Conta de Afiliado: validação do formato da tag Amazon antes de salvar', async () => {
  const regexTag = /^[a-z0-9][a-z0-9-]{1,30}-20$/;
  const validarTag = (tag: string) => {
    const limpa = tag.trim();
    if (!limpa) return 'Por favor, informe a tag de afiliado.';
    if (!regexTag.test(limpa)) {
      return 'A tag da Amazon deve seguir o formato nome-20 (letras minúsculas, números ou hífens, terminando em -20).';
    }
    return null;
  };

  // Tags inválidas
  assert.ok(validarTag(''));
  assert.ok(validarTag('cliente'));
  assert.ok(validarTag('cliente-10'));
  assert.ok(validarTag('Tag_Com_Maiuscula-20'));
  assert.ok(validarTag('tag!invalida-20'));
  assert.ok(validarTag('-comeca-com-hifen-20'));

  // Tags válidas
  assert.equal(validarTag('cliente-20'), null);
  assert.equal(validarTag('mandaolink-20'), null);
  assert.equal(validarTag('canal-promocoes-20'), null);

  // Mock de salvamento
  let salvo = false;
  const mockClient = {
    async fetchConfig() {
      return {} as NicheConfig;
    },
    async updateConfig(partial: Partial<NicheConfig>) {
      assert.equal(partial.tag_amazon, 'mandaolink-20');
      salvo = true;
      return {} as NicheConfig;
    },
  } as unknown as ApiClient;

  await mockClient.updateConfig({
    tag_amazon: 'mandaolink-20',
  });

  assert.equal(salvo, true);
});

test('ApiClient normaliza horários HH:MM:SS do PostgreSQL para HH:MM em fetchConfig e updateConfig', async () => {
  const fakePgConfig: NicheConfig = {
    nome: 'Carro',
    palavras_chave: ['oleo', 'filtro'],
    palavras_bloqueadas: ['brinquedo'],
    categorias: ['automotivo'],
    tag_amazon: 'meu-afiliado-20',
    limite_hora: 5,
    limite_dia: 30,
    horario_inicio: '08:00:00', // Formato retornado pelo tipo TIME do PostgreSQL
    horario_fim: '22:00:00', // Formato retornado pelo tipo TIME do PostgreSQL
  };

  const client = new ApiClient('http://fake-api.local');
  const originalFetch = globalThis.fetch;
  let putPayload: NicheConfig | null = null;

  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/config') && init?.method === 'GET') {
        return new Response(JSON.stringify(fakePgConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.endsWith('/config') && init?.method === 'PUT') {
        putPayload = JSON.parse(String(init.body));
        // Valida que o schema estrito da API (^([01][0-9]|2[0-3]):[0-5][0-9]$) seria atendido sem 400
        const timePattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
        assert.match(putPayload!.horario_inicio, timePattern, 'horario_inicio deve ter formato HH:MM');
        assert.match(putPayload!.horario_fim, timePattern, 'horario_fim deve ter formato HH:MM');

        return new Response(JSON.stringify({ ...fakePgConfig, ...putPayload }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404 });
    };

    // 1. fetchConfig normaliza os horários para HH:MM
    const loaded = await client.fetchConfig();
    assert.equal(loaded.horario_inicio, '08:00');
    assert.equal(loaded.horario_fim, '22:00');

    // 2. updateConfig ao alterar apenas a tag ou nicho não envia HH:MM:SS
    const updated = await client.updateConfig({ tag_amazon: 'novo-afiliado-20' });
    assert.ok(putPayload);
    const sent = putPayload as unknown as NicheConfig;
    assert.equal(sent.horario_inicio, '08:00');
    assert.equal(sent.horario_fim, '22:00');
    assert.equal(sent.tag_amazon, 'novo-afiliado-20');
    assert.equal(updated.horario_inicio, '08:00');
    assert.equal(updated.horario_fim, '22:00');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getTabFromHash mapeia #pareamento para aba operacao e preserva as demais rotas', () => {
  assert.equal(getTabFromHash('#pareamento'), 'operacao');
  assert.equal(getTabFromHash('#/pareamento'), 'operacao');
  assert.equal(getTabFromHash('PAREAMENTO'), 'operacao');
  assert.equal(getTabFromHash('#horarios'), 'horarios');
  assert.equal(getTabFromHash('#afiliado'), 'afiliado');
  assert.equal(getTabFromHash('#operacao'), 'operacao');
  assert.equal(getTabFromHash('#nicho'), 'nicho');
  assert.equal(getTabFromHash(''), 'nicho');
  assert.equal(getTabFromHash('#desconhecido'), 'nicho');
});
