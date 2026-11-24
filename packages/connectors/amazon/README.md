# @mandaolink/connector-amazon (S1)

Lê título, preço, foto e disponibilidade da página pública `https://www.amazon.com.br/dp/{ASIN}`, **sem tag e sem login**. Insumo do G4 e do G9.

## Uso

```ts
import { createAmazonReader, createBrowserReader, createFetchReader } from '@mandaolink/connector-amazon';

const reader = createAmazonReader({
  primary: createFetchReader(),                                         // padrão: ~2 s, sem navegador
  fallback: createBrowserReader({ userDataDir: './data/amazon-profile' }), // só quando o fetch bloqueia
});
const r = await reader.read('B0FN8CH3KG');
// r.ok → r.product { title, priceCents, priceText, image, available, pageAsin, checkedAt }
// !r.ok → r.reason: bloqueado_captcha | bloqueado_http_503 | em_pausa_por_bloqueio | produto_inexistente | asin_invalido | http_* | rede:*
```

Comportamento:
- Uma leitura por vez, com 2 a 4 s entre leituras (sorteado). **Fixo, não configurável** (decisão do TL).
- Bloqueio no fetch → tenta no Playwright. Bloqueio nos dois → **pausa fixa de 30 min**: devolve `em_pausa_por_bloqueio` com `retryAt`, sem requisitar.
- **Uma instância por processo**, compartilhada entre ingestão e fila (o ritmo vive na instância). O G4 deve tratar `bloqueado_*`/`em_pausa_*`/`rede:*` como **ADIA**, e `produto_inexistente` como REPROVA.
- Falha fechada: preço só da caixa de compra (campo do formulário ou `priceToPay` do bloco principal). Sem isso, `priceCents = null`.
- `pageAsin` vem do canonical. Se diferir do ASIN pedido, a Amazon mostrou outra variação; o G4 deve reprovar.
- O Playwright **não** sobrescreve o user-agent: UA divergente da versão do Chromium dá captcha na 1ª página (medido). Para manter o UA estável, fixe a versão do `playwright`.

## Testes e medições

```powershell
npm install
npx playwright install chromium     # só para o fallback e o discover
npm test                            # 10 testes offline (recorte de página real + captcha real)
node scripts/discover-asins.ts      # coleta ASINs reais do nicho Carro pela busca → fixtures/asins-carro.txt
node scripts/bench.ts sample fetch 30
node scripts/bench.ts sample browser 30
node scripts/bench.ts rate fetch <minutos> <gapMs>   # ritmo fixo até acabar o tempo ou o 1º bloqueio
```

Resultados em `reports/*.json` e no `RELATORIO-S1.md`.

## Não faz
Não loga na Amazon, não abre link com tag (nossa ou de terceiros), não usa a busca no pipeline (a busca só serviu para montar a amostra).
