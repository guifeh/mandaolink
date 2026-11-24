// Leitores da página /dp/{ASIN}, sempre sem tag e sem login.
// Caminho padrão: fetch simples (rápido, ~2 s, sem navegador). Se vier bloqueio, tenta no
// Playwright com perfil persistente. Se os dois bloquearem, entra em pausa (cooldown) e
// devolve bloqueado_* para o G4 adiar, sem martelar a Amazon.

import { detectBlock, parseProductHtml, type Product } from './parse.ts';

export type ReadFailure =
  | 'bloqueado_captcha'
  | 'bloqueado_http_503'
  | 'em_pausa_por_bloqueio'
  | 'produto_inexistente'
  | 'asin_invalido'
  | `http_${number}`
  | `rede:${string}`;

export type ReadResult =
  | { ok: true; product: Product; via: 'fetch' | 'browser'; ms: number }
  | { ok: false; reason: ReadFailure; via: 'fetch' | 'browser' | 'nenhum'; ms: number; /** Bloqueio: não tentar antes disto (epoch ms). */ retryAt?: number };

export interface ProductReader {
  read(asin: string): Promise<ReadResult>;
  close(): Promise<void>;
}

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const ASIN_RE = /^[A-Z0-9]{10}$/;
const productUrl = (asin: string) => `https://www.amazon.com.br/dp/${asin}`;

function fromPage(asin: string, status: number, html: string, via: 'fetch' | 'browser', ms: number): ReadResult {
  const block = detectBlock(status, html);
  if (block) return { ok: false, reason: block, via, ms };
  if (status === 404) return { ok: false, reason: 'produto_inexistente', via, ms };
  if (status >= 400) return { ok: false, reason: `http_${status}`, via, ms };
  return { ok: true, product: parseProductHtml(asin, html), via, ms };
}

export function createFetchReader(opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): ProductReader {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async read(asin) {
      const t0 = Date.now();
      try {
        const res = await doFetch(productUrl(asin), {
          headers: {
            'user-agent': USER_AGENT,
            'accept-language': 'pt-BR,pt;q=0.9',
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        });
        return fromPage(asin, res.status, await res.text(), 'fetch', Date.now() - t0);
      } catch (e) {
        return { ok: false, reason: `rede:${(e as Error).name}`, via: 'fetch', ms: Date.now() - t0 };
      }
    },
    async close() {},
  };
}

/** Playwright com perfil persistente. Só carrega HTML e scripts: imagem, fonte e mídia são cortadas. */
export function createBrowserReader(opts: { userDataDir: string; headless?: boolean; timeoutMs?: number }): ProductReader {
  let ctxPromise: Promise<import('playwright').BrowserContext> | null = null;
  const context = () =>
    (ctxPromise ??= import('playwright').then(async ({ chromium }) => {
      const ctx = await chromium.launchPersistentContext(opts.userDataDir, {
        headless: opts.headless ?? true,
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        // Sem userAgent fixo de propósito: um UA que não bate com a versão real do Chromium
        // (client hints) leva a captcha na 1ª página. O UA fica estável fixando a versão do Playwright.
        viewport: { width: 1366, height: 900 },
      });
      await ctx.route('**/*', (route) =>
        ['image', 'font', 'media'].includes(route.request().resourceType()) ? route.abort() : route.continue(),
      );
      return ctx;
    }));

  return {
    async read(asin) {
      const t0 = Date.now();
      const page = await (await context()).newPage();
      try {
        const res = await page.goto(productUrl(asin), { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 30_000 });
        return fromPage(asin, res?.status() ?? 0, await page.content(), 'browser', Date.now() - t0);
      } catch (e) {
        return { ok: false, reason: `rede:${(e as Error).name}`, via: 'browser', ms: Date.now() - t0 };
      } finally {
        await page.close();
      }
    },
    async close() {
      if (ctxPromise) await (await ctxPromise).close();
    },
  };
}

const isBlock = (r: ReadResult) => !r.ok && r.reason.startsWith('bloqueado_');

/** Ritmo e pausa fixos do leitor de produção (decisão do TL): não são configuráveis. */
export const MIN_GAP_MS = 2000;
export const MAX_GAP_MS = 4000;
export const BLOCK_COOLDOWN_MS = 30 * 60_000;

export type AmazonReaderOptions = {
  primary: ProductReader;
  fallback?: ProductReader;
  /** Só para testes: relógio e espera injetáveis. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Leitor usado pelo pipeline: serializa as leituras com ritmo de 2 a 4 s, tenta o fallback
 * em caso de bloqueio e para de ler por 30 min. Uma leitura por vez, de propósito.
 * Use UMA instância por processo, compartilhada entre ingestão e fila.
 */
export function createAmazonReader(o: AmazonReaderOptions): ProductReader & { pausedUntil(): number } {
  return createPacedReader({ ...o, minGapMs: MIN_GAP_MS, maxGapMs: MAX_GAP_MS, cooldownMs: BLOCK_COOLDOWN_MS });
}

/** Interno: o mesmo leitor com ritmo livre, só para o benchmark de taxa (scripts/bench.ts). Não exportado no index. */
export function createPacedReader(
  o: AmazonReaderOptions & { minGapMs: number; maxGapMs: number; cooldownMs: number },
): ProductReader & { pausedUntil(): number } {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const minGap = o.minGapMs;
  const maxGap = o.maxGapMs;
  const cooldown = o.cooldownMs;
  let last = -Infinity;
  let paused = 0;
  let chain: Promise<unknown> = Promise.resolve();

  async function readOnce(asin: string): Promise<ReadResult> {
    if (!ASIN_RE.test(asin)) return { ok: false, reason: 'asin_invalido', via: 'nenhum', ms: 0 };
    if (now() < paused) return { ok: false, reason: 'em_pausa_por_bloqueio', via: 'nenhum', ms: 0, retryAt: paused };
    const wait = last + minGap + Math.random() * (maxGap - minGap) - now();
    if (wait > 0) await sleep(wait);
    let r = await o.primary.read(asin);
    last = now();
    if (isBlock(r) && o.fallback) {
      r = await o.fallback.read(asin);
      last = now();
    }
    if (isBlock(r)) {
      paused = now() + cooldown;
      return { ...r, retryAt: paused } as ReadResult;
    }
    return r;
  }

  return {
    read(asin) {
      const p = chain.then(() => readOnce(asin));
      chain = p.catch(() => {});
      return p;
    },
    pausedUntil: () => paused,
    async close() {
      await o.primary.close();
      await o.fallback?.close();
    },
  };
}
