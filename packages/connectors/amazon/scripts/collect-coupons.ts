// Coleta páginas reais com cupom de produto (para calibrar o parser de cupom).
// Usa a busca pública só para achar cards com selo de cupom; salva as páginas /dp/ em .samples/.
// Uso: node scripts/collect-coupons.ts [maxPaginas=12] [asinExtra...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [maxArg, ...extra] = process.argv.slice(2);
const max = Number(maxArg ?? 12);
const QUERIES = ['acessorios automotivos', 'suporte celular carro', 'aspirador automotivo', 'cera automotiva', 'carregador veicular'];

mkdirSync('.samples', { recursive: true });
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const pause = () => page.waitForTimeout(2500 + Math.random() * 1500);
const found = new Map<string, string>();

for (const q of QUERIES) {
  if (found.size >= max) break;
  await page.goto(`https://www.amazon.com.br/s?k=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });
  const cards = await page.$$eval('div[data-component-type="s-search-result"][data-asin]', (els) =>
    els.map((e) => ({ asin: e.getAttribute('data-asin') ?? '', text: (e as HTMLElement).innerText })),
  );
  for (const c of cards) {
    const m = c.text.match(/[^\n]*cupom[^\n]*/i);
    if (m && c.asin.length === 10 && !found.has(c.asin)) found.set(c.asin, m[0].trim());
  }
  console.error(`${q}: ${cards.length} cards, com cupom até agora: ${found.size}`);
  await pause();
}

const targets = [...extra.map((a) => [a, '(extra)'] as const), ...[...found].slice(0, max)];
for (const [asin, badge] of targets) {
  const res = await page.goto(`https://www.amazon.com.br/dp/${asin}`, { waitUntil: 'domcontentloaded' });
  const html = await page.content();
  writeFileSync(`.samples/cupom-${asin}.html`, html);
  console.log(`${asin}\t${res?.status()}\t${/productTitle/.test(html) ? 'produto' : 'SEM_PRODUTO'}\t${badge}`);
  await pause();
}
await browser.close();
