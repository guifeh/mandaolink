import type { Coupon, GateResult, LastSend, ProductRead, ResolvedProduct } from './pipeline-types.js';
import type { NicheGateResult } from './niche.js';

const pass = (): GateResult => ({ status: 'PASSA' });
const reject = (motivo: string): GateResult => ({ status: 'REPROVA', motivo });
export const money = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function g0(
  source: { ativa: boolean; autorizada: boolean; publicadaEm: number },
  now: number,
  maxAge = 30 * 60000,
): GateResult {
  if (!source.ativa || !source.autorizada) return reject('fonte inativa');
  return !Number.isFinite(source.publicadaEm) || source.publicadaEm > now || now - source.publicadaEm > maxAge
    ? reject('mensagem antiga')
    : pass();
}
export const g1 = (urls: string[]): GateResult => (urls.length ? pass() : reject('sem link'));
export function g2(resolved: ResolvedProduct): GateResult {
  if (!resolved.ok) return reject(resolved.reason === 'loja_nao_suportada' ? 'loja não suportada' : 'link não resolve');
  return resolved.store === 'amazon' && /^[A-Z0-9]{10}$/.test(resolved.asin) ? pass() : reject('link não resolve');
}
export function g3(
  last: LastSend | null,
  now: number,
  opts: { janelaMs?: number; quedaPercentual?: number; precoAtualCentavos?: number | null } = {},
): GateResult {
  if (!last || now - last.enviadoEm >= (opts.janelaMs ?? 24 * 3600000)) return pass();
  if (
    opts.quedaPercentual !== undefined &&
    opts.quedaPercentual > 0 &&
    opts.quedaPercentual <= 100 &&
    money(last.precoCentavos) &&
    money(opts.precoAtualCentavos) &&
    (last.precoCentavos - opts.precoAtualCentavos) * 100 >= last.precoCentavos * opts.quedaPercentual
  )
    return pass();
  return reject('repetida');
}
export function g4(read: ProductRead, asin: string, now: number, maxAge = 30 * 60000): GateResult {
  if (!read.ok)
    return ['produto_inexistente', 'asin_invalido', 'http_404'].includes(read.reason)
      ? reject('indisponível')
      : {
          status: 'ADIA',
          motivo: read.reason,
          quando: Number.isFinite(read.retryAt) && read.retryAt! > now ? read.retryAt! : now + 5 * 60000,
        };
  const p = read.product;
  const checked = Date.parse(p.checkedAt);
  return p.asin === asin &&
    p.pageAsin === asin &&
    !!p.title?.trim() &&
    p.available === true &&
    money(p.priceCents) &&
    !!p.image &&
    /^https:\/\//.test(p.image) &&
    Number.isFinite(checked) &&
    checked <= now &&
    now - checked <= maxAge
    ? pass()
    : reject('indisponível');
}
export function g5(niche: NicheGateResult, category?: string | null, categories: string[] = []): GateResult {
  if (niche.status !== 'PASSA') return reject(niche.motivoDescritivo);
  if (categories.length && category && !categories.includes(category)) return reject('fora do nicho');
  return pass();
}
export function g6(current: number | null, advertised?: number | null, coupon?: Coupon | null): GateResult {
  if (!money(current) || (advertised != null && !money(advertised))) return reject('oferta vencida');
  let effective = current;
  if (coupon?.presente) {
    if (!coupon.legivel || (coupon.valorCentavos === undefined) === (coupon.percentual === undefined))
      return reject('cupom_ilegivel');
    if (coupon.valorCentavos !== undefined) {
      if (!Number.isSafeInteger(coupon.valorCentavos) || coupon.valorCentavos < 0 || coupon.valorCentavos > current)
        return reject('cupom_ilegivel');
      effective -= coupon.valorCentavos;
    } else {
      if (!Number.isFinite(coupon.percentual) || coupon.percentual! <= 0 || coupon.percentual! > 100)
        return reject('cupom_ilegivel');
      // Arredonda para cima: nao inventar um preco menor que o desconto calculado.
      effective = Math.ceil((current * 100 - current * coupon.percentual!) / 100);
    }
  }
  return advertised == null || effective * 100 <= advertised * 105 ? pass() : reject('oferta vencida');
}
export function affiliateLink(asin: string, tag: string): string {
  return `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(tag)}`;
}
export function g7(asin: string, tag: string, link: string): GateResult {
  return /^[A-Z0-9]{10}$/.test(asin) && /^[a-z0-9][a-z0-9-]{1,30}-20$/.test(tag) && link === affiliateLink(asin, tag)
    ? pass()
    : reject('falha ao gerar link');
}
export const g8 = (validation: { status: string; valida: boolean }): GateResult =>
  validation.status === 'PASSA' && validation.valida ? pass() : reject('mensagem inválida');
export function g9(received: number, queued: number, now: number, ttl = 2 * 3600000): GateResult {
  return [received, queued, now, ttl].every(Number.isFinite) &&
    ttl > 0 &&
    received <= now &&
    queued <= now &&
    now - received <= ttl &&
    now - queued <= ttl
    ? pass()
    : reject('vencida na fila');
}
