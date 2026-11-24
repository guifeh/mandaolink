import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadReferenceFixtures,
  evaluateReferenceSuite,
  runReferenceSuite,
  formatEvaluationReport,
} from '../src/runner.js';
import type { ReferenceCase, PipelineDecision } from '../src/types.js';

test('dataset de referência possui pelo menos 40 casos sintéticos válidos', async () => {
  const cases = await loadReferenceFixtures();
  assert.ok(cases.length >= 40, `Esperado pelo menos 40 casos, encontrados: ${cases.length}`);

  const validGateMotivos = new Set([
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
  ]);

  for (const c of cases) {
    assert.equal(c.tipo, 'exemplo', `Caso ${c.id} deve ser marcado como tipo 'exemplo'`);
    assert.ok(c.mensagem.texto.length > 0, `Caso ${c.id} possui texto vazio`);

    if (c.contexto?.asin) {
      assert.match(
        c.contexto.asin,
        /^(B0EXEMPL[0-9]{2}|CURTO12)$/,
        `Caso ${c.id} deve usar ASIN sintético`
      );
    }

    if (c.esperado.rotulo === 'enviar') {
      assert.equal(c.esperado.motivo, null, `Caso ${c.id} aprovado não deve ter motivo de reprovação`);
      assert.equal(c.esperado.gateEsperado, null, `Caso ${c.id} aprovado não deve ter gate de reprovação`);
    } else {
      assert.ok(
        c.esperado.motivo && validGateMotivos.has(c.esperado.motivo.toLowerCase()),
        `Caso ${c.id} possui motivo não mapeado nos gates: ${c.esperado.motivo}`
      );
      assert.ok(c.esperado.gateEsperado, `Caso ${c.id} reprovado deve apontar gate esperada`);
    }
  }
});

test('runner atinge 100% de acerto com pipeline ideal', async () => {
  const cases = await loadReferenceFixtures();

  const pipelineIdeal = (caso: ReferenceCase): PipelineDecision => ({
    rotulo: caso.esperado.rotulo,
    motivo: caso.esperado.motivo,
    gate: caso.esperado.gateEsperado,
  });

  const report = await evaluateReferenceSuite(cases, pipelineIdeal);

  assert.equal(report.taxaAcertoRotulo, 100);
  assert.equal(report.taxaAcertoMotivo, 100);
  assert.equal(report.falsosPositivos, 0);
  assert.equal(report.falsosNegativos, 0);
  assert.equal(report.discrepancias.length, 0);
  assert.equal(report.acertosRotulo, cases.length);

  const formatted = formatEvaluationReport(report);
  assert.ok(formatted.includes('Nenhuma discrepância encontrada'));
});

test('runner detecta falsos positivos, falsos negativos e erros de motivo', async () => {
  const mockCases: ReferenceCase[] = [
    {
      id: 'm1',
      tipo: 'exemplo',
      descricao: 'Deveria enviar',
      mensagem: {
        texto: 'Suporte veicular https://amazon.com.br/dp/B0EXEMPL01',
        link: 'https://amazon.com.br/dp/B0EXEMPL01',
        fonte: { id: 'f1', plataforma: 'whatsapp', ativa: true },
        publicadaEm: '2026-11-23T15:00:00Z',
      },
      esperado: { rotulo: 'enviar', motivo: null, gateEsperado: null },
    },
    {
      id: 'm2',
      tipo: 'exemplo',
      descricao: 'Deveria reprovar por sem link',
      mensagem: {
        texto: 'Sem link aqui',
        link: null,
        fonte: { id: 'f1', plataforma: 'whatsapp', ativa: true },
        publicadaEm: '2026-11-23T15:00:00Z',
      },
      esperado: { rotulo: 'nao_enviar', motivo: 'sem link', gateEsperado: 'G1' },
    },
    {
      id: 'm3',
      tipo: 'exemplo',
      descricao: 'Deveria reprovar por repetida',
      mensagem: {
        texto: 'Repetida https://amazon.com.br/dp/B0EXEMPL02',
        link: 'https://amazon.com.br/dp/B0EXEMPL02',
        fonte: { id: 'f1', plataforma: 'whatsapp', ativa: true },
        publicadaEm: '2026-11-23T15:00:00Z',
      },
      esperado: { rotulo: 'nao_enviar', motivo: 'repetida', gateEsperado: 'G3' },
    },
  ];

  // Pipeline com falhas propositais:
  // - m1: descarta incorretamente (falso negativo)
  // - m2: aprova incorretamente (falso positivo)
  // - m3: descarta, mas com motivo incorreto
  const pipelineFalho = (caso: ReferenceCase): PipelineDecision => {
    if (caso.id === 'm1') return { rotulo: 'nao_enviar', motivo: 'indisponível' };
    if (caso.id === 'm2') return { rotulo: 'enviar' };
    return { rotulo: 'nao_enviar', motivo: 'motivo_errado' };
  };

  const report = await evaluateReferenceSuite(mockCases, pipelineFalho);

  assert.equal(report.totalCasos, 3);
  assert.equal(report.falsosNegativos, 1);
  assert.equal(report.falsosPositivos, 1);
  assert.equal(report.acertosRotulo, 1); // só m3 acertou rótulo
  assert.equal(report.acertosMotivo, 0); // nenhum acertou motivo
  assert.equal(report.discrepancias.length, 3);

  const formatted = formatEvaluationReport(report);
  assert.ok(formatted.includes('Discrepâncias Encontradas (3)'));
});

test('runReferenceSuite executa ponta a ponta carregando arquivo padrao', async () => {
  const report = await runReferenceSuite((c) => ({
    rotulo: c.esperado.rotulo,
    motivo: c.esperado.motivo,
  }));
  assert.equal(report.taxaAcertoRotulo, 100);
});
