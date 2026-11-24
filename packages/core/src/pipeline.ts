import { extractSourceUrls } from './resolve.js';
import { affiliateLink, g0, g1, g2, g3, g4, g5, g6, g7, g8, g9 } from './gates.js';
import type {
  GateResult,
  PipelineConfig,
  PipelineDependencies,
  PipelineInput,
  PipelineOutcome,
  ProductRead,
  QueuedOffer,
  ResolvedProduct,
} from './pipeline-types.js';

async function readProduct(d: PipelineDependencies, asin: string): Promise<ProductRead> {
  try {
    return await d.reader.read(asin);
  } catch {
    return { ok: false, reason: 'falha de leitura' };
  }
}
function validateConfig(c: PipelineConfig) {
  for (const value of [c.idadeMaximaMs, c.janelaDedupMs, c.ttlMs, c.reverAposMs])
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error('duracao invalida');
  if (
    c.quedaPercentual !== undefined &&
    (!Number.isFinite(c.quedaPercentual) || c.quedaPercentual <= 0 || c.quedaPercentual > 100)
  )
    throw new Error('queda percentual invalida');
}
export async function runPipeline(
  input: PipelineInput,
  config: PipelineConfig,
  d: PipelineDependencies,
): Promise<PipelineOutcome> {
  validateConfig(config);
  const state: PipelineOutcome = { gate: 0, resultado: { status: 'PASSA' } };
  const log = async (gate: number, result: GateResult) => {
    Object.assign(state, { gate, resultado: result });
    await d.record({
      mensagemId: input.mensagemId,
      asin: state.asin,
      produto: state.produto,
      gate,
      resultado: result,
      criadoEm: d.now(),
    });
    return result.status === 'PASSA';
  };
  if (
    !(await log(
      0,
      g0(
        {
          ...input.fonte,
          ativa: input.fonte.ativa && config.fontesPermitidas.includes(input.fonte.id),
          publicadaEm: input.publicadaEm,
        },
        d.now(),
        config.idadeMaximaMs,
      ),
    ))
  )
    return state;
  const urls = extractSourceUrls(input.texto);
  if (!(await log(1, g1(urls)))) return state;
  let resolved: ResolvedProduct = { ok: false, reason: 'loja_nao_suportada' };
  for (const url of urls) {
    try {
      resolved = await d.resolve(url);
    } catch {
      resolved = { ok: false, reason: 'link não resolve' };
    }
    if (resolved.ok || resolved.reason !== 'loja_nao_suportada') break;
  }
  if (resolved.ok && g2(resolved).status === 'PASSA') state.asin = resolved.asin;
  if (!(await log(2, g2(resolved)))) return state;
  const asin = state.asin!;
  const last = await d.lastSend(asin);
  let read: ProductRead | undefined;
  if (
    last &&
    config.quedaPercentual !== undefined &&
    d.now() - last.enviadoEm < (config.janelaDedupMs ?? 24 * 3600000)
  ) {
    read = await readProduct(d, asin);
    const valid = g4(read, asin, d.now(), config.reverAposMs);
    if (valid.status === 'ADIA') {
      await log(3, valid);
      return state;
    }
  }
  if (
    !(await log(
      3,
      g3(last, d.now(), {
        janelaMs: config.janelaDedupMs,
        quedaPercentual: config.quedaPercentual,
        precoAtualCentavos: read?.ok ? read.product.priceCents : null,
      }),
    ))
  )
    return state;
  read ??= await readProduct(d, asin);
  if (read.ok) state.produto = read.product;
  if (!(await log(4, g4(read, asin, d.now(), config.reverAposMs)))) return state;
  const product = state.produto!;
  if (!(await log(5, g5(d.nicheGate(product.title, config.nicho, product.category))))) return state;
  if (!(await log(6, g6(product.priceCents, input.precoFonteCentavos, product.cupom)))) return state;
  state.link = affiliateLink(asin, config.tagAmazon);
  if (!(await log(7, g7(asin, config.tagAmazon, state.link)))) return state;
  try {
    state.mensagem = d.renderMessage({
      titulo: product.title!,
      precoCents: product.priceCents,
      imagemUrl: product.image,
      verificadaEm: product.checkedAt,
      link: state.link,
      temCupom: product.cupom?.presente ?? false,
    });
    await log(8, g8(d.validateMessage(state.mensagem, state.link, { fonteTextoParaVerificar: input.texto })));
  } catch {
    await log(8, { status: 'REPROVA', motivo: 'mensagem inválida' });
  }
  return state;
}

/** G9 pertence ao consumidor da fila, nunca ao momento de ingestao. */
export async function runBeforeSend(offer: QueuedOffer, d: PipelineDependencies): Promise<PipelineOutcome> {
  const { input, config, asin } = offer;
  validateConfig(config);
  const state: PipelineOutcome = {
    gate: 9,
    asin,
    produto: offer.produto,
    resultado: g9(input.recebidaEm, offer.enfileiradaEm, d.now(), config.ttlMs),
  };
  const record = async (gate: number, resultado: GateResult) => {
    state.resultado = resultado;
    await d.record({ mensagemId: input.mensagemId, asin, gate, resultado, produto: state.produto, criadoEm: d.now() });
    return resultado.status === 'PASSA';
  };
  if (!input.fonte.ativa || !input.fonte.autorizada || !config.fontesPermitidas.includes(input.fonte.id)) {
    await record(9, { status: 'REPROVA', motivo: 'fonte inativa' });
    return state;
  }
  if (state.resultado.status !== 'PASSA') {
    await record(9, state.resultado);
    return state;
  }
  if (!state.produto) {
    await record(9, { status: 'REPROVA', motivo: 'indisponível' });
    return state;
  }
  if (d.now() - Date.parse(state.produto.checkedAt) > (config.reverAposMs ?? 30 * 60000)) {
    const read = await readProduct(d, asin);
    if (read.ok) state.produto = read.product;
    if (!(await record(4, g4(read, asin, d.now(), config.reverAposMs)))) {
      await record(9, state.resultado);
      return state;
    }
  } else if (!(await record(4, g4({ ok: true, product: state.produto }, asin, d.now(), config.reverAposMs)))) {
    await record(9, state.resultado);
    return state;
  }
  if (
    !(await record(5, g5(d.nicheGate(state.produto.title, config.nicho, state.produto.category)))) ||
    !(await record(6, g6(state.produto.priceCents, input.precoFonteCentavos, state.produto.cupom)))
  ) {
    await record(9, state.resultado);
    return state;
  }
  state.link = affiliateLink(asin, config.tagAmazon);
  if (!(await record(7, g7(asin, config.tagAmazon, state.link)))) {
    await record(9, state.resultado);
    return state;
  }
  const p = state.produto;
  try {
    state.mensagem = d.renderMessage({
      titulo: p.title!,
      precoCents: p.priceCents,
      imagemUrl: p.image,
      verificadaEm: p.checkedAt,
      link: state.link,
      temCupom: p.cupom?.presente ?? false,
    });
    if (
      !(await record(8, g8(d.validateMessage(state.mensagem, state.link, { fonteTextoParaVerificar: input.texto }))))
    ) {
      await record(9, state.resultado);
      return state;
    }
  } catch {
    await record(9, { status: 'REPROVA', motivo: 'mensagem inválida' });
    return state;
  }
  await record(9, g9(input.recebidaEm, offer.enfileiradaEm, d.now(), config.ttlMs));
  return state;
}
