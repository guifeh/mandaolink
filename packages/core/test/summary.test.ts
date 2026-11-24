import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  traduzirMotivo,
  MOTIVO_GENERICO_PADRAO,
  buildDailySummary,
  formatarDataBrasilia,
} from '../src/index.js';

test('todos os códigos de motivos dos gates possuem tradução específica no mapa', () => {
  // Lista oficial de motivos de gates (G0 a G9)
  const codigosObrigatorios = [
    'fonte inativa',
    'mensagem antiga',
    'sem link',
    'loja não suportada',
    'link não resolve',
    'repetida',
    'indisponível',
    'fora do nicho',
    'palavra bloqueada',
    'oferta vencida',
    'cupom_ilegivel',
    'falha ao gerar link',
    'mensagem inválida',
    'vencida na fila',
  ];

  for (const codigo of codigosObrigatorios) {
    const frase = traduzirMotivo(codigo);
    assert.notEqual(
      frase,
      MOTIVO_GENERICO_PADRAO,
      `O código de gate "${codigo}" deve possuir tradução legível mapeada no dicionário.`
    );
    assert.ok(frase.length > 3, `A frase para "${codigo}" deve ser descritiva`);
  }
});

test('traduzirMotivo recorre ao texto genérico quando código for desconhecido ou nulo', () => {
  assert.equal(traduzirMotivo('codigo_totalmente_desconhecido'), MOTIVO_GENERICO_PADRAO);
  assert.equal(traduzirMotivo(null), MOTIVO_GENERICO_PADRAO);
  assert.equal(traduzirMotivo(undefined), MOTIVO_GENERICO_PADRAO);
  assert.equal(traduzirMotivo(''), MOTIVO_GENERICO_PADRAO);
});

test('formatarDataBrasilia formata corretamente data no fuso de São Paulo', () => {
  const formatada = formatarDataBrasilia('2026-11-23');
  assert.equal(formatada, '23/11/2026');
});

test('buildDailySummary gera resumo curto, completo e sem termos técnicos', () => {
  const dados = {
    enviadas: 28,
    descartadas: 142,
    motivosPrincipais: [
      { motivo: 'fora_do_nicho', quantidade: 84 },
      { motivo: 'oferta vencida', quantidade: 32 },
      { motivo: 'palavra bloqueada', quantidade: 15 },
      { motivo: 'repetida', quantidade: 11 }, // deve limitar ao top 3
    ],
    tempoParadoMinutos: 45,
    pendenciasAbertas: 2,
  };

  const texto = buildDailySummary(dados, '2026-11-23');

  // Validações de conteúdo
  assert.ok(texto.includes('Resumo MandaoLink — 23/11/2026'));
  assert.ok(texto.includes('28 ofertas enviadas'));
  assert.ok(texto.includes('142 descartadas'));
  assert.ok(texto.includes('• Não é do nicho (84)'));
  assert.ok(texto.includes('• Preço subiu ou oferta acabou (32)'));
  assert.ok(texto.includes('• Contém palavra proibida (15)'));
  // Garante que o 4º motivo não apareceu
  assert.ok(!texto.includes('repetida'));
  assert.ok(texto.includes('Pausado por 45 min'));
  assert.ok(texto.includes('2 pendências para revisar'));

  // Não contém termos técnicos
  assert.ok(!texto.includes('gate'));
  assert.ok(!texto.includes('ASIN'));
  assert.ok(!texto.includes('G5'));
  assert.ok(!texto.includes('G6'));

  // Validação de brevidade (no máximo ~12 linhas)
  const linhas = texto.split('\n').filter((l) => l.trim().length > 0);
  assert.ok(linhas.length <= 10, `Resumo deve ser conciso (linhas não vazias: ${linhas.length})`);
});

test('buildDailySummary trata cenários sem interrupções e sem pendências', () => {
  const dados = {
    enviadas: 35,
    descartadas: 10,
    motivosPrincipais: [
      { motivo: 'repetida', quantidade: 8 },
      { motivo: 'cupom_ilegivel', quantidade: 2 },
    ],
    tempoParadoMinutos: 0,
    pendenciasAbertas: 0,
  };

  const texto = buildDailySummary(dados, '2026-11-23');

  assert.ok(texto.includes('35 ofertas enviadas'));
  assert.ok(texto.includes('10 descartadas'));
  assert.ok(texto.includes('• Oferta já enviada recentemente (8)'));
  assert.ok(texto.includes('• Cupom sem valor visível (2)'));
  assert.ok(texto.includes('Funcionamento contínuo'));
  assert.ok(texto.includes('Nenhuma pendência aberta'));
});
