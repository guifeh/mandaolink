// Coleta ASINs reais da busca pública da Amazon para montar a amostra do relatório S1.
// Uso: node scripts/discover-asins.ts  (grava fixtures/asins-carro.txt)
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const QUERIES = [
  'suporte celular carro',
  'carregador veicular usb',
  'aspirador de pó automotivo',
  'cera automotiva',
  'compressor de ar portátil carro',
  'câmera de ré',
  'tapete automotivo',
  'shampoo automotivo',
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ locale: 'pt-BR', viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const seen = new Set<string>();
const lines: string[] = [];

for (const q of QUERIES) {
  await page.goto(`https://www.amazon.com.br/s?k=${encodeURIComponent(q)}`, { waitUntil: 'domcontentloaded' });
  const asins = await page.$$eval('div[data-component-type="s-search-result"][data-asin]', (els) =>
    els.map((e) => e.getAttribute('data-asin')).filter((a): a is string => !!a && a.length === 10),
  );
  console.error(`${q}: ${asins.length} (title: ${await page.title()})`);
  for (const a of asins.slice(0, 6)) {
    if (!seen.has(a)) {
      seen.add(a);
      lines.push(`${a}\t${q}`);
    }
  }
  await page.waitForTimeout(2500 + Math.random() * 1500);
}
await browser.close();
writeFileSync('fixtures/asins-carro.txt', lines.join('\n') + '\n');
console.error(`${lines.length} ASINs`);
