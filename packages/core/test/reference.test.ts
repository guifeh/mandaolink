import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, runBeforeSend } from '../src/pipeline.js';
import { loadReferenceFixtures, evaluateReferenceSuite, formatEvaluationReport } from '../src/runner.js';
import { resolve } from '../src/resolve.js';
import { nicheGate, DEFAULT_CAR_NICHE_CONFIG } from '../src/niche.js';
import { renderMessage, validateMessage } from '../src/message.js';
import type { PipelineConfig, PipelineDependencies, ProductSnapshot } from '../src/pipeline-types.js';
test('pipeline contra fixtures sinteticas sem consultar rotulo esperado', async () => {
  const report = await evaluateReferenceSuite(
    await loadReferenceFixtures(),
    async ({ mensagem, contexto = {}, id }) => {
      let now = Date.parse(contexto.agora!);
      const received = now;
      const config: PipelineConfig = {
        fontesPermitidas: [mensagem.fonte.id],
        tagAmazon: contexto.tagAmazon ?? 'cliente-20',
        nicho: {
          ...DEFAULT_CAR_NICHE_CONFIG,
          palavras_chave: [...DEFAULT_CAR_NICHE_CONFIG.palavras_chave, 'automotiva'],
          palavras_bloqueadas: [...DEFAULT_CAR_NICHE_CONFIG.palavras_bloqueadas, 'jogo de cartas'],
        },
      };
      const input = {
        mensagemId: id,
        texto: mensagem.texto,
        fonte: { ...mensagem.fonte, autorizada: true },
        publicadaEm: Date.parse(mensagem.publicadaEm),
        recebidaEm: received,
        precoFonteCentavos: contexto.precoAnunciadoCents,
      };
      const product = (): ProductSnapshot => ({
        asin: contexto.asin!,
        pageAsin: contexto.asin!,
        title: contexto.tituloOficial ?? null,
        priceCents: contexto.precoAtualCents ?? null,
        available: contexto.disponivel ?? null,
        image: 'https://images.example.test/synthetic.jpg',
        checkedAt: new Date(now).toISOString(),
        category: contexto.categoria,
        cupom: contexto.cupom,
      });
      const fakeFetch = async (url: string) =>
        new Response(null, {
          status: 302,
          headers: {
            location: url.includes('loop')
              ? url
              : contexto.asin && /^[A-Z0-9]{10}$/.test(contexto.asin)
                ? `https://www.amazon.com.br/dp/${contexto.asin}?tag=terceiro-20`
                : 'https://amzn.to/loop',
          },
        });
      const d: PipelineDependencies = {
        now: () => now,
        resolve: (url) => resolve(url, fakeFetch as typeof fetch),
        reader: { read: async () => ({ ok: true, product: product() }) },
        lastSend: async () =>
          contexto.jaEnviadoJanela24h
            ? { enviadoEm: now - 3600000, precoCentavos: contexto.precoAtualCents ?? null }
            : null,
        record: async () => {},
        nicheGate,
        validateMessage,
        renderMessage: (offer) => {
          const rendered = renderMessage(offer);
          return contexto.mensagemRenderizadaComErro
            ? { ...rendered, texto: contexto.mensagemRenderizadaComErro }
            : rendered;
        },
      };
      let out = await runPipeline(input, config, d);
      if (out.resultado.status === 'PASSA') {
        now += (contexto.tempoNaFilaMinutos ?? 0) * 60000;
        out = await runBeforeSend(
          { input, config, asin: out.asin!, produto: out.produto!, enfileiradaEm: received },
          d,
        );
      }
      return {
        rotulo: out.resultado.status === 'PASSA' ? 'enviar' : 'nao_enviar',
        motivo: out.resultado.status === 'PASSA' ? null : out.resultado.motivo,
        gate: `G${out.gate}`,
      };
    },
  );
  console.log(formatEvaluationReport(report));
  assert.equal(report.taxaAcertoRotulo, 100);
  assert.equal(report.taxaAcertoMotivo, 100);
});
