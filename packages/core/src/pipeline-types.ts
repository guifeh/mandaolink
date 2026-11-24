import type { NicheFilterConfig, NicheGateResult } from './niche.js';
import type { OfertaParaRender, RenderedMessage, MessageValidationResult } from './message.js';
import type { CupomInfo } from './types.js';

export type GateResult = { status: 'PASSA' } | { status: 'REPROVA'; motivo: string } | { status: 'ADIA'; motivo: string; quando: number };
export type Coupon = CupomInfo;
export interface ProductSnapshot {
  asin: string; pageAsin: string | null; title: string | null; priceCents: number | null;
  image: string | null; available: boolean | null; checkedAt: string; category?: string | null; cupom?: Coupon | null;
}
export type ProductRead = { ok: true; product: ProductSnapshot } | { ok: false; reason: string; retryAt?: number };
export interface ProductReader { read(asin: string): Promise<ProductRead> }
export type ResolvedProduct = { ok: true; store: 'amazon'; asin: string } | { ok: false; reason: string };
export interface LastSend { enviadoEm: number; precoCentavos: number | null }
export interface PipelineInput {
  mensagemId: string; texto: string; fonte: { id: string; ativa: boolean; autorizada: boolean };
  publicadaEm: number; recebidaEm: number; precoFonteCentavos?: number | null;
}
export interface PipelineConfig {
  fontesPermitidas: string[]; nicho: NicheFilterConfig; tagAmazon: string;
  idadeMaximaMs?: number; janelaDedupMs?: number; quedaPercentual?: number;
  ttlMs?: number; reverAposMs?: number;
}
export interface GateEvent {
  mensagemId: string; asin?: string; gate: number; resultado: GateResult; criadoEm: number;
  produto?: ProductSnapshot;
}
export interface PipelineDependencies {
  reader: ProductReader;
  resolve(url: string): Promise<ResolvedProduct>;
  lastSend(asin: string): Promise<LastSend | null>;
  record(event: GateEvent): Promise<void>;
  now(): number;
  nicheGate(title: string | null, config: NicheFilterConfig, category?: string | null): NicheGateResult;
  renderMessage(offer: OfertaParaRender): RenderedMessage;
  validateMessage(message: RenderedMessage, link: string, options?: { fonteTextoParaVerificar?: string }): MessageValidationResult;
}
export interface PipelineOutcome {
  resultado: GateResult; gate: number; asin?: string; produto?: ProductSnapshot;
  link?: string; mensagem?: RenderedMessage;
}
export interface QueuedOffer {
  input: PipelineInput; config: PipelineConfig; asin: string; produto: ProductSnapshot;
  enfileiradaEm: number;
}
