// Recorta de uma página real salva só os trechos que o parser usa, para testes offline.
// Uso: node scripts/make-fixture.ts <pagina.html> <saida.html>
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
const h = readFileSync(src, 'utf8');
const cut = (re: RegExp, len: number) => {
  const i = h.search(re);
  return i < 0 ? '' : h.slice(i, i + len);
};
const parts = [
  h.match(/<link rel="canonical"[^>]*>/)?.[0] ?? '',
  h.match(/<span[^>]*id="productTitle"[^>]*>[\s\S]*?<\/span>/)?.[0] ?? '',
  cut(/<div[^>]*id="corePrice(?:Display)?_desktop_feature_div"/, 6000),
  cut(/<div[^>]*id="promoPriceBlockMessage_feature_div"/, 20000).replace(/<script[\s\S]*?<\/script>/gi, ''),
  h.match(/<img[^>]*id="landingImage"[^>]*>/)?.[0] ?? '',
  h.match(/<div[^>]*id="availability"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '',
  h.match(/<input[^>]*name="items\[0\.base\]\[customerVisiblePrice\]\[amount\]"[^>]*>/)?.[0] ?? '',
];
writeFileSync(out, parts.join('\n'));
console.log(out, parts.map((p) => p.length));
