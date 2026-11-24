import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nicheGate, normalizeText, buildTermRegex, DEFAULT_CAR_NICHE_CONFIG } from '../src/niche.js';
import { loadReferenceFixtures, evaluateReferenceSuite } from '../src/runner.js';

test('normalizeText remove acentos, caixa alta e pontuações', () => {
  assert.equal(normalizeText('Acessório de CARRO!'), 'acessorio de carro');
  assert.equal(normalizeText('   Câmera   Veicular   1080p   '), 'camera veicular 1080p');
  assert.equal(normalizeText('pneu/calibrador'), 'pneu calibrador');
});

test('buildTermRegex casa palavras inteiras e plurais simples sem casar substrings', () => {
  const reCarro = buildTermRegex('carro');
  assert.ok(reCarro.test('suporte para carro'), 'deve casar carro');
  assert.ok(reCarro.test('acessorios para carros novos'), 'deve casar plural carros');
  assert.ok(!reCarro.test('passeio de carrossel no parque'), 'NÃO deve casar carrossel');
  assert.ok(!reCarro.test('carroceria reforçada'), 'NÃO deve casar carroceria');

  const reSom = buildTermRegex('som automotivo');
  assert.ok(reSom.test('kit de som automotivo potente'), 'deve casar expressao composta');
  assert.ok(!reSom.test('som residencial'), 'nao deve casar expressao incompleta');
});

test('nicheGate aprova produtos válidos do nicho Carro', () => {
  const casosValidos = [
    'Suporte Veicular Magnético de Celular para Painel e Saída de Ar',
    'Carregador Veicular Rápido 30W Duplo USB Automotivo',
    'Câmera Veicular Automotiva Dash Cam Full HD com Gravação Contínua',
    'Aspirador de Pó Automotivo Portátil 12V com Acessórios',
    'Cera Automotiva de Carnaúba Plus Proteção e Brilho para Veículos',
    'Calibrador e Compressor de Ar Digital Automotivo Portátil Recarregável',
    'Organizador de Porta-Malas Automotivo Dobrável',
    'Par de Lâmpadas Automotivas H4 Farol Alto e Baixo',
  ];

  for (const titulo of casosValidos) {
    const res = nicheGate(titulo, DEFAULT_CAR_NICHE_CONFIG);
    assert.equal(res.status, 'PASSA', `Falhou ao aprovar: ${titulo}`);
  }
});

test('nicheGate reprova casos de borda com palavras bloqueadas (precedência máxima)', () => {
  const casosBloqueados = [
    { titulo: 'Carrinho de Bebê Passeio Compacto Dobrável', termo: 'carrinho de bebe' },
    { titulo: 'Carro de Controle Remoto Elétrico 4x4 Brinquedo Infantil', termo: 'brinquedo' },
    { titulo: 'Pista de Corrida Hot Wheels Ataque do Tubarão', termo: 'hot wheels' },
    { titulo: 'Jogo de Tabuleiro e Cartas para Família', termo: 'jogo de tabuleiro' },
    { titulo: 'Miniatura de Carro Fusca Coleção', termo: 'miniatura' },
  ];

  for (const c of casosBloqueados) {
    const res = nicheGate(c.titulo, DEFAULT_CAR_NICHE_CONFIG);
    assert.equal(res.status, 'REPROVA', `Deveria reprovar: ${c.titulo}`);
    assert.equal(res.motivo, 'palavra_bloqueada');
    assert.equal(res.motivoDescritivo, 'palavra bloqueada');
  }
});

test('nicheGate reprova produtos fora do nicho Carro', () => {
  const casosFora = [
    'Smartphone Xiaomi Redmi Note 13 4G 256GB 8GB RAM',
    'O Poder do Hábito: Por que fazemos o que fazemos na vida',
    'Kit de Maquiagem Facial Batom Líquido Matte e Máscara',
    'Fone de Ouvido Bluetooth Sem Fio TWS com Microfone',
    'Tênis Esportivo Masculino para Corrida e Caminhada',
  ];

  for (const titulo of casosFora) {
    const res = nicheGate(titulo, DEFAULT_CAR_NICHE_CONFIG);
    assert.equal(res.status, 'REPROVA', `Deveria reprovar fora do nicho: ${titulo}`);
    assert.equal(res.motivo, 'fora_do_nicho');
    assert.equal(res.motivoDescritivo, 'fora do nicho');
  }
});

test('nicheGate integra com o runner da J2 e alcança 100% nos casos de nicho (G5)', async () => {
  const cases = await loadReferenceFixtures();
  // Filtra casos relevantes para nicho: os que falham no G5 e os válidos
  const casosNicho = cases.filter((c) => c.esperado.gateEsperado === 'G5' || c.esperado.rotulo === 'enviar');

  const pipelineG5 = (caso: (typeof cases)[0]) => {
    const titulo = caso.contexto?.tituloOficial ?? caso.mensagem.texto;
    const gateRes = nicheGate(titulo, DEFAULT_CAR_NICHE_CONFIG, caso.contexto?.categoria);

    if (gateRes.status === 'PASSA') {
      return { rotulo: 'enviar' as const, motivo: null, gate: null };
    }
    return {
      rotulo: 'nao_enviar' as const,
      motivo: gateRes.motivoDescritivo,
      gate: 'G5',
    };
  };

  const report = await evaluateReferenceSuite(casosNicho, pipelineG5);

  assert.equal(report.taxaAcertoRotulo, 100, `Acurácia de rótulo no G5 deve ser 100%`);
  assert.equal(report.taxaAcertoMotivo, 100, `Acurácia de motivo no G5 deve ser 100%`);
  assert.equal(report.falsosPositivos, 0);
  assert.equal(report.falsosNegativos, 0);
  assert.equal(report.discrepancias.length, 0);
});
