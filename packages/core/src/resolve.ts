// Adaptado do PoC do TL: segue apenas Location e nunca abre o produto com tag alheia.
export type ResolveResult =
  | { ok: true; store: 'amazon'; asin: string; hops: string[]; ms: number }
  | { ok: false; reason: string; hops: string[]; ms: number };
const AMAZON = /(^|\.)amazon\.com\.br$/i;
const SHORTENER = /(^|\.)(amzn\.to|a\.co|amzn\.eu|bit\.ly|tinyurl\.com|cutt\.ly|is\.gd|t\.co)$/i;
const ASINS = [
  /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/exec\/obidos\/ASIN\/([A-Z0-9]{10})(?:[/?#]|$)/i,
  /\/o\/ASIN\/([A-Z0-9]{10})(?:[/?#]|$)/i,
];
export function extractSourceUrls(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')))];
}
export function asinFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !AMAZON.test(url.hostname)
  )
    return null;
  for (const pattern of ASINS) {
    const match = url.pathname.match(pattern);
    if (match) return match[1].toUpperCase();
  }
  return null;
}
export async function resolve(start: string, doFetch: typeof fetch = fetch): Promise<ResolveResult> {
  const started = Date.now(),
    hops = [start];
  const fail = (reason: string): ResolveResult => ({ ok: false, reason, hops, ms: Date.now() - started });
  const signal = AbortSignal.timeout(10000);
  let current = start;
  for (let i = 0; i <= 5; i++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      return fail('url_invalida');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
      return fail('url_invalida');
    const asin = asinFromUrl(current);
    if (asin) return { ok: true, store: 'amazon', asin, hops, ms: Date.now() - started };
    if (!SHORTENER.test(url.hostname) && !AMAZON.test(url.hostname)) return fail('loja_nao_suportada');
    // Sem ASIN nao ha como chegar ao produto sem arriscar um clique de afiliado.
    if ([...url.searchParams.keys()].some((k) => ['tag', 'ascsubtag', 'linkcode'].includes(k.toLowerCase())))
      return fail('url_afiliada_sem_asin');
    if (i === 5) return fail('muitos_redirecionamentos');
    try {
      const response = await doFetch(current, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        signal,
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (response.status < 300 || response.status >= 400 || !location)
        return fail(`sem_produto:http_${response.status}`);
      current = new URL(location, current).toString();
      hops.push(current);
      if (/(^|\.)amzn\.to$/i.test(url.hostname) && !asinFromUrl(current)) return fail('destino_sem_asin');
    } catch (error) {
      return fail(`rede:${error instanceof Error ? error.name : 'erro'}`);
    }
  }
  return fail('muitos_redirecionamentos');
}
