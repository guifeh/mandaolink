import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import type {
  ReferenceCase,
  PipelineFunction,
  EvaluationReport,
  Discrepancia,
  GateMetrics,
  ContadoresObtidos,
} from './types.js';

export function getDefaultFixturesPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '..', 'fixtures', 'reference-cases.json');
}

export async function loadReferenceFixtures(
  customPath?: string
): Promise<ReferenceCase[]> {
  const targetPath = customPath ?? getDefaultFixturesPath();
  const raw = await readFile(targetPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('O arquivo de fixtures deve conter um array JSON de casos.');
  }
  return parsed as ReferenceCase[];
}

function normalizeMotivo(motivo: string | null | undefined): string | null {
  if (!motivo) return null;
  return motivo.trim().toLowerCase();
}

export async function evaluateReferenceSuite(
  cases: ReferenceCase[],
  pipeline: PipelineFunction
): Promise<EvaluationReport> {
  let acertosRotulo = 0;
  let acertosMotivo = 0;
  let falsosPositivos = 0;
  let falsosNegativos = 0;

  const porGate: Record<string, GateMetrics> = {};
  const discrepancias: Discrepancia[] = [];
  const contadoresObtidos: ContadoresObtidos = {
    ofertaVencida: 0,
    cupomIlegivel: 0,
  };

  for (const caso of cases) {
    const gateKey = caso.esperado.gateEsperado ?? 'VALIDO';
    if (!porGate[gateKey]) {
      porGate[gateKey] = { total: 0, acertosRotulo: 0, acertosMotivo: 0 };
    }
    porGate[gateKey].total++;

    const resultado = await pipeline(caso);

    const rotuloIgual = resultado.rotulo === caso.esperado.rotulo;
    const motivoEsperadoNorm = normalizeMotivo(caso.esperado.motivo);
    const motivoObtidoNorm = normalizeMotivo(resultado.motivo);

    // Contadores reais dos motivos obtidos
    if (resultado.rotulo === 'nao_enviar' && resultado.motivo) {
      const key = motivoObtidoNorm ?? 'desconhecido';
      contadoresObtidos[key] = (contadoresObtidos[key] ?? 0) + 1;
      if (key === 'oferta vencida' || key === 'oferta_vencida') {
        contadoresObtidos.ofertaVencida++;
      }
      if (key === 'cupom_ilegivel' || key === 'cupom ilegivel') {
        contadoresObtidos.cupomIlegivel++;
      }
    }

    // Se ambos forem null/undefined ou se coincidirem textualmente
    const motivoIgual =
      caso.esperado.rotulo === 'enviar'
        ? resultado.rotulo === 'enviar'
        : rotuloIgual &&
          (motivoEsperadoNorm === motivoObtidoNorm ||
            (motivoEsperadoNorm === 'oferta vencida' && motivoObtidoNorm === 'oferta_vencida') ||
            (motivoEsperadoNorm === 'cupom_ilegivel' && motivoObtidoNorm === 'cupom ilegivel'));

    if (rotuloIgual) {
      acertosRotulo++;
      porGate[gateKey].acertosRotulo++;
    } else {
      if (caso.esperado.rotulo === 'nao_enviar' && resultado.rotulo === 'enviar') {
        falsosPositivos++;
      } else if (caso.esperado.rotulo === 'enviar' && resultado.rotulo === 'nao_enviar') {
        falsosNegativos++;
      }
    }

    if (motivoIgual) {
      acertosMotivo++;
      porGate[gateKey].acertosMotivo++;
    }

    if (!rotuloIgual || !motivoIgual) {
      let tipoDiscrepancia: 'rotulo' | 'motivo' | 'ambos' = 'ambos';
      if (!rotuloIgual && motivoIgual) {
        tipoDiscrepancia = 'rotulo';
      } else if (rotuloIgual && !motivoIgual) {
        tipoDiscrepancia = 'motivo';
      }

      discrepancias.push({
        id: caso.id,
        descricao: caso.descricao,
        gateEsperado: caso.esperado.gateEsperado,
        esperado: {
          rotulo: caso.esperado.rotulo,
          motivo: caso.esperado.motivo,
        },
        obtido: {
          rotulo: resultado.rotulo,
          motivo: resultado.motivo ?? null,
          gate: resultado.gate ?? null,
        },
        tipoDiscrepancia,
      });
    }
  }

  const totalCasos = cases.length;
  const taxaAcertoRotulo =
    totalCasos > 0 ? Number(((acertosRotulo / totalCasos) * 100).toFixed(2)) : 0;
  const taxaAcertoMotivo =
    totalCasos > 0 ? Number(((acertosMotivo / totalCasos) * 100).toFixed(2)) : 0;

  return {
    totalCasos,
    acertosRotulo,
    acertosMotivo,
    taxaAcertoRotulo,
    taxaAcertoMotivo,
    falsosPositivos,
    falsosNegativos,
    porGate,
    contadoresObtidos,
    discrepancias,
  };
}

export async function runReferenceSuite(
  pipeline: PipelineFunction,
  customFixturesPath?: string
): Promise<EvaluationReport> {
  const cases = await loadReferenceFixtures(customFixturesPath);
  return evaluateReferenceSuite(cases, pipeline);
}

export function formatEvaluationReport(report: EvaluationReport): string {
  const lines: string[] = [
    `=== Relatório de Avaliação do Pipeline (Conjunto de Referência) ===`,
    `Total de casos avaliados: ${report.totalCasos}`,
    `Taxa de acerto de rótulo (enviar/nao_enviar): ${report.taxaAcertoRotulo}% (${report.acertosRotulo}/${report.totalCasos})`,
    `Taxa de acerto de motivo: ${report.taxaAcertoMotivo}% (${report.acertosMotivo}/${report.totalCasos})`,
    `Falsos positivos (não deveria enviar, mas enviou): ${report.falsosPositivos}`,
    `Falsos negativos (deveria enviar, mas descartou): ${report.falsosNegativos}`,
    ``,
    `--- Contadores Obtidos em G6 ---`,
    `  Ofertas vencidas descartadas: ${report.contadoresObtidos.ofertaVencida}`,
    `  Cupons ilegíveis descartados: ${report.contadoresObtidos.cupomIlegivel}`,
    ``,
    `--- Desempenho por Gate ---`,
  ];

  for (const [gate, metrics] of Object.entries(report.porGate)) {
    const taxa = metrics.total > 0 ? ((metrics.acertosRotulo / metrics.total) * 100).toFixed(1) : '0';
    lines.push(
      `  Gate ${gate.padEnd(6)}: ${metrics.acertosRotulo}/${metrics.total} acertos (${taxa}%)`
    );
  }

  if (report.discrepancias.length > 0) {
    lines.push(``, `--- Discrepâncias Encontradas (${report.discrepancias.length}) ---`);
    for (const d of report.discrepancias) {
      lines.push(
        `  [${d.id}] ${d.descricao}`,
        `    Esperado: rotulo=${d.esperado.rotulo}, motivo=${d.esperado.motivo ?? 'nenhum'}`,
        `    Obtido:   rotulo=${d.obtido.rotulo}, motivo=${d.obtido.motivo ?? 'nenhum'} (tipo: ${d.tipoDiscrepancia})`
      );
    }
  } else {
    lines.push(``, `Parabéns! Nenhuma discrepância encontrada.`);
  }

  return lines.join('\n');
}
