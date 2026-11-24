// Leitura do HTML da página /dp/{ASIN} da Amazon Brasil: título, preço, foto e disponibilidade.
// Regra: na dúvida, devolve null. Um preço errado publica oferta ruim; um null só descarta.

export type Product = {
  asin: string;
  /** ASIN da página que respondeu (canonical). Pode diferir quando a Amazon redireciona para outra variação. */
  pageAsin: string | null;
  title: string | null;
  priceText: string | null;
  priceCents: number | null;
  image: string | null;
  available: boolean | null;
  cupom: Cupom;
  checkedAt: string;
};

/**
 * Cupom do produto ("Aplicar Cupom de 5%"), que o comprador marca na página.
 * Promoções gerais da Amazon (código de primeira compra, "em pedidos R$ 40+") não contam:
 * aparecem em quase todo produto e não baixam o preço deste item.
 */
export type Cupom = { presente: boolean; legivel: boolean; valorCentavos?: number; percentual?: number };

export type BlockKind = 'bloqueado_captcha' | 'bloqueado_http_503' | null;

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function first(html: string, res: RegExp[]): string | null {
  for (const re of res) {
    const m = html.match(re);
    if (m?.[1]) {
      const v = decode(m[1]);
      if (v) return v;
    }
  }
  return null;
}

export function parsePriceCents(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{1,3}(?:\.\d{3})*|\d+),(\d{2})/);
  if (!m) return null;
  return Number(m[1].replace(/\./g, '')) * 100 + Number(m[2]);
}

function formatBRL(cents: number): string {
  const reais = Math.floor(cents / 100).toLocaleString('pt-BR');
  return `R$ ${reais},${String(cents % 100).padStart(2, '0')}`;
}

/** Preço da caixa de compra. Só olha o bloco principal; não cai para um a-price qualquer da página. */
function buyBoxPrice(html: string): { text: string; cents: number } | null {
  // 1) Campo do formulário de compra: valor numérico, independente do layout visual.
  const form = html.match(/name="items\[0\.base\]\[customerVisiblePrice\]\[amount\]"\s+value="(\d+(?:\.\d{1,2})?)"/);
  if (form) {
    const cents = Math.round(Number(form[1]) * 100);
    if (cents > 0) return { text: formatBRL(cents), cents };
  }
  // 2) Bloco corePrice: o span priceToPay (inteiro + fração) ou o a-offscreen preenchido.
  const start = html.search(/id="corePrice(?:Display)?_(?:desktop|mobile)_feature_div"/);
  if (start < 0) return null;
  const core = html.slice(start, start + 6000);
  const ptp = core.match(/priceToPay[\s\S]{0,600}?a-price-whole">([\d.]+)[\s\S]{0,120}?a-price-fraction">(\d{2})</);
  if (ptp) {
    const text = `R$ ${ptp[1]},${ptp[2]}`;
    return { text, cents: parsePriceCents(text)! };
  }
  const off = first(core, [/<span class="a-offscreen">\s*(R\$[^<]+)<\/span>/i]);
  const cents = parsePriceCents(off);
  return off && cents ? { text: off, cents } : null;
}

export function parseCoupon(html: string): Cupom {
  const label = html.match(/<span[^>]*class="couponLabelText"[^>]*>([\s\S]*?)<(?:span|a)\b/i)?.[1];
  if (label === undefined) {
    // Texto de cupom de produto sem a marcação conhecida: existe, mas não sabemos ler (falha fechada).
    const block = html.match(/id="promoPriceBlockMessage_feature_div"[\s\S]{0,8000}/)?.[0] ?? '';
    return /Aplicar\s+cupom/i.test(decode(block.replace(/<script[\s\S]*?<\/script>/gi, '')))
      ? { presente: true, legivel: false }
      : { presente: false, legivel: true };
  }
  const t = decode(label);
  const pct = t.match(/(\d{1,2}(?:,\d+)?)\s*%/);
  if (pct) {
    const percentual = Number(pct[1].replace(',', '.'));
    if (percentual > 0 && percentual < 100) return { presente: true, legivel: true, percentual };
  }
  const brl = t.match(/R\$\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/);
  if (brl) {
    const valorCentavos = Number(brl[1].replace(/\./g, '')) * 100 + Number(brl[2] ?? 0);
    if (valorCentavos > 0) return { presente: true, legivel: true, valorCentavos };
  }
  return { presente: true, legivel: false };
}

export function parseProductHtml(asin: string, html: string, now = new Date()): Product {
  const title = first(html, [/<span[^>]*id="productTitle"[^>]*>([\s\S]*?)<\/span>/i]);
  const price = buyBoxPrice(html);

  // A ordem dos atributos muda; isola a tag <img id="landingImage"> e lê os atributos dela.
  const imgTag = html.match(/<img\b[^>]*\bid="landingImage"[^>]*>/i)?.[0] ?? '';
  const image =
    first(imgTag, [/data-old-hires="(https:[^"]+)"/i, /\bsrc="(https:[^"]+)"/i]) ??
    first(html, [/"hiRes":"(https:[^"]+)"/i]);

  // O bloco de disponibilidade carrega <script> com JSON; tira antes de procurar o texto.
  const availRaw = html.match(/<div[^>]*id="availability"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? null;
  const availText = availRaw ? decode(availRaw.replace(/<script[\s\S]*?<\/script>/gi, '')) : null;
  const unavailable = /indispon[ií]vel|n[ãa]o dispon[ií]vel|não temos previsão/i;
  const available = availText ? !unavailable.test(availText) : price ? true : null;

  const canonical = html.match(/<link rel="canonical" href="[^"]*\/dp\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() ?? null;

  return {
    asin,
    pageAsin: canonical,
    title,
    priceText: price?.text ?? null,
    priceCents: price?.cents ?? null,
    image,
    available,
    cupom: parseCoupon(html),
    checkedAt: now.toISOString(),
  };
}

/** Página de bloqueio da Amazon (captcha "robot check" ou 503 de proteção). */
export function detectBlock(status: number, html: string): BlockKind {
  if (/productTitle/.test(html)) return null;
  if (/validateCaptcha|Type the characters you see|Digite os caracteres|api-services-support@amazon\.com/i.test(html)) {
    return 'bloqueado_captcha';
  }
  if (status === 503) return 'bloqueado_http_503';
  return null;
}
