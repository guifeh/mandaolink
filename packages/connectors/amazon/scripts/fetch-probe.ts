// Sonda: a página /dp/ responde a fetch simples (sem navegador)? Compara com o achado da busca (503).
import { readFileSync } from 'node:fs';

const asins = readFileSync('fixtures/asins-carro.txt', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t')[0]);
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
for (const a of asins.slice(0, Number(process.argv[2] ?? 5))) {
  const t0 = Date.now();
  const res = await fetch(`https://www.amazon.com.br/dp/${a}`, { headers: HEADERS });
  const html = await res.text();
  console.log(a, res.status, html.length, /productTitle/.test(html) ? 'titulo' : '-', /captcha/i.test(html) ? 'captcha' : '-', `${Date.now() - t0}ms`);
  await new Promise((r) => setTimeout(r, 2500));
}
