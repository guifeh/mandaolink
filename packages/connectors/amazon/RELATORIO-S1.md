# S1 — Leitura do produto Amazon: relatório

Data: 23/11/2026, PC local (IP residencial). Leitura de páginas públicas `/dp/{ASIN}`, sem tag, sem login.
Amostra: 47 ASINs reais do nicho Carro, coletados da busca pública (8 termos: suporte, carregador, aspirador, cera, compressor, câmera de ré, tapete, shampoo), em `fixtures/asins-carro.txt`. As rodadas de amostra usam os 30 primeiros.

## 1. Amostra de 30 ASINs

| Rodada | Via | Publicável¹ | Tempo médio | p95 | Falhas |
|---|---|---|---|---|---|
| 1 | fetch simples | 30/30 (100%) | 1,9 s | 2,3 s | — |
| 2 | Playwright | 30/30 (100%) | 2,1 s | 2,6 s | — |
| 3 (final, código com cupom) | auto: fetch + fallback² | 30/30 (100%) | 2,2 s | 3,0 s | — |

¹ Publicável = título + preço da caixa de compra + foto + em estoque + canonical igual ao ASIN pedido.
² Na rodada 3, o fetch ainda estava bloqueado pelo teste de taxa (seção 2). O fallback leu 27 de 30 pelo navegador, sem nenhuma falha.

Motivos de falha vistos no conjunto todo (incluindo o teste de taxa):
- `sem_preco`: 1 ASIN (B0FLW41Q2X). A página não tem oferta destacada, só "Ver todas as opções de compra". O leitor devolve `priceCents=null`, que é o correto (falha fechada).
- `bloqueado_captcha`: só no teste de taxa.
- Na 1ª tentativa, o Playwright com user-agent forçado (Chrome 142 num Chromium 159) recebeu captcha na 1ª página. Corrigido: o UA não é mais sobrescrito.

## 2. Leituras por hora sem bloqueio

| Teste | Ritmo | Resultado |
|---|---|---|
| fetch, intervalo fixo de 1 s | ~1.280 leituras/h | 397 leituras OK, **captcha na leitura 398** (~19 min) |
| fetch, logo depois, sem intervalo | — | captcha na 1ª leitura |
| fetch, ~14 min depois | — | ainda bloqueado na maioria (3/30 passaram) |
| Playwright, durante o bloqueio do fetch | 2 a 4 s | **não bloqueado**: 27/27 |

Leitura:
- Teto observado: **~400 leituras em rajada contínua**, a ~1.280/h. O bloqueio é por IP mais assinatura de cliente: o fetch fica bloqueado por mais de 14 min, e o navegador, no mesmo IP, segue passando.
- Necessidade real do MVP: **~20 a 60 leituras/h** (ofertas únicas depois do G3, mais as releituras do G9). Isso fica 20 a 60 vezes abaixo do ponto de bloqueio, no ritmo padrão de 2 a 4 s (~1.200/h no máximo).
- Proteções no leitor: uma leitura por vez; fallback para o navegador; pausa de 30 min se os dois bloquearem (`em_pausa_por_bloqueio` com `retryAt`).
- **Não medido:** o teto sustentado em 24 h e o comportamento em IP de datacenter (VPS). Refazer `bench.ts rate` na VPS antes de migrar, como o TL já decidiu.

## 3. Cupom

`cupom: { presente, legivel, valorCentavos?, percentual? }`, lido da página.
- Na **amostra de 30: 0 com cupom de produto e 0 ilegíveis.**
- Busca dirigida: dos 13 itens com selo de cupom na busca, **12 eram a promoção geral da Amazon** (códigos de primeira compra, como PRIMEIRA20BF e 10OFFBF, "em pedidos R$ 40+"). **1 tinha cupom do produto** (B0HDXCR3V7, "Aplicar Cupom de 5%"), lido como `{presente:true, legivel:true, percentual:5}`.
- Regra: a promoção geral **não** conta como cupom, porque aparece em quase todo produto, depende da conta e não baixa o preço do item. Conta só o `couponLabelText` ("Aplicar Cupom de X% / R$ Y"). Se o texto "Aplicar cupom" aparecer sem valor legível, o retorno é `presente:true, legivel:false`, e o G6 reprova.
- Recorte real para os testes: `fixtures/pagina-B0HDXCR3V7-cupom.html` e `fixtures/pagina-B0DW9BYSCZ-promo-geral.html`.

## 4. Entrega
- `src/parse.ts`: título, preço (campo do formulário de compra → `priceToPay` do bloco principal; nunca um preço solto da página), foto, disponibilidade, canonical, cupom e detecção de captcha/503.
- `src/reader.ts`: fetch, Playwright com perfil persistente (corta imagem, fonte e mídia) e o leitor com ritmo, fallback e pausa.
- `npm test`: **14/14 passando**, offline, com recortes de páginas reais e a página de captcha real.
- Scripts: `discover-asins.ts`, `bench.ts` (sample / rate, via fetch | browser | auto), `collect-coupons.ts` e `make-fixture.ts`.
- Relatórios brutos: `reports/*.json`.

## 5. Pontos para o pipeline
- O ProductReader é uma instância por processo, compartilhada entre a ingestão e a fila. O ritmo e a pausa vivem nela.
- No G4: `bloqueado_*`, `em_pausa_*` e `rede:*` → ADIA até `retryAt`, quando vier; `produto_inexistente` → REPROVA; `pageAsin ≠ asin` → REPROVA.
- O Chromium precisa estar instalado no PC (`npx playwright install chromium`) para o fallback funcionar.
