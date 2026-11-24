# MandaoLink — design (direção "Faixa de sinal", paleta Cobalto, pele v2)

Dono: UX/UI. Aprovado pelo Guilherme em 24/11/2026: a direção "Faixa de sinal", a paleta **Cobalto** e a **pele v2**. O Figma ainda não está conectado, então a fonte da verdade são estes protótipos HTML estáticos e os tokens em CSS.

## Arquivos
| Arquivo | O que é |
|---|---|
| `apps/pwa/src/styles/tokens.css` | Variáveis: cores, semáforo, tipografia, espaços, raios, movimento. |
| `apps/pwa/src/styles/componentes.css` | Componentes base com prefixo `.ml-`: casco e navegação, faixa de sinal, aviso, botão, item de lista, campo, filtro, interruptor, passos, código, prévia, trilha, confirmação, skeleton, vazio. |
| `docs/design/fase-a.html` | Prancha com todas as telas da fase A em 390×844 e 1280×800. |
| `docs/design/fase-b.html` | Prancha da fase B (configurar e avisar). |
| `docs/design/telas/*.html` | Um arquivo por estado, que abre sozinho em qualquer largura. |

Os protótipos usam os **mesmos** CSS do app. Se a tela do protótipo e a do app divergirem, um dos dois está errado.

## Regras da direção
1. **A cor é o estado.** Verde, âmbar e vermelho só aparecem quando significam algo (faixa, ponto do item, etiqueta, erro). A marca é o **cobalto** `#2541d8` (`--cor-casco`), sólido e sem degradê, usado só no que é do produto: aba ativa, botão principal, filtro e foco. Pausa feita pelo cliente é neutra (`--cor-pausado`), nunca vermelha.
2. **Uma ação por estado.** A faixa de sinal tem no máximo um botão principal. A pausa geral fica embaixo, como botão secundário, e sempre pede confirmação.
3. **Frase grande, condensada, só na faixa.** A Archivo condensada (`wdth 70`, peso 800) é exclusiva da frase do estado e do código de pareamento (largo, `wdth 125`). O resto usa largura normal.
4. **Sem emoji na interface** (o emoji só aparece dentro da prévia da mensagem do WhatsApp, porque faz parte da mensagem). Ícones próprios em SVG de traço 1,6 px, sempre com rótulo: sinal (Início), sino (Pendências), relógio que volta (Histórico) e controles (Ajustes). Copie os SVG dos protótipos.
5. **Texto sem termos técnicos.** Os motivos vêm de `packages/core/src/motivosLegiveis.ts`. As frases das telas estão nos protótipos e podem ser copiadas.
6. **Movimento:** veja a seção "Pele v2: regras de movimento" abaixo.
7. **Acessibilidade mínima:** zoom liberado, contraste AA (os valores estão em `tokens.css`), alvo de 48 px, foco visível de 3 px, `aria-current` na aba, `role="switch"` nos interruptores, erro embaixo do campo com `aria-describedby` e `aria-invalid`, e `aria-live` na faixa.

## Navegação
4 abas: **Início**, **Pendências** (com contador), **Histórico** e **Ajustes**.
- **Celular:** barra flutuante de vidro (`backdrop-filter: blur(20px) saturate(1.8)`), a 12 px das bordas e acima da safe-area, com uma pílula cobalto atrás da aba ativa.
- **Folga:** todo conteúdo rolável termina acima da barra. O `.ml-principal` recebe `padding-bottom: var(--folga-nav)` (altura da barra + margem + `env(safe-area-inset-bottom)` + 24 px). Não remova; foi conferido em todas as 71 telas com barra.
- **Computador (≥ 960 px):** a barra vira uma sidebar flutuante. O conteúdo vai até 880 px. O Início, a partir de 1100 px, usa duas colunas: estado e "Também precisa de você" à esquerda; números do dia, últimas publicadas e pausa à direita (até 1160 px). A tipografia sobe um degrau (corpo 18 px, título 28 px, frase do estado 56 px). Pendências vira grade de cartões. O conserto do WhatsApp (A4) e os grupos de origem (A6) abrem a partir de Pendências ou de Ajustes, com o link de voltar no topo.

## Estados cobertos (fase A)
| Tela | Estados |
|---|---|
| A1 Login | padrão, enviando, e-mail enviado (reenviar com espera), link vencido ou usado, limite de tentativas, e-mail inválido, sessão expirada, entrando, erro de rede |
| A2 Início | verde, amarelo, vermelho, pausado por você, pausado pelo sistema, modo teste, sem nenhuma fonte, carregando, erro de rede, confirmação da pausa |
| A3 Pendências | lista, pausado por falhas, número bloqueado, item resolvido com "Desfazer", vazio, carregando, erro de rede |
| A4 Conectar WhatsApp | número, número inválido, código gerado, código expirado, conectado, número bloqueado, erro; no computador: QR |
| A5 Histórico | lista, filtro "Incertas", vazio do dia, fim da lista, carregando, erro de rede; detalhe: enviada, descartada, incerta |
| A6 Grupos de origem | entrada por Ajustes, lista, fonte perdida, WhatsApp não conectado, nenhum grupo, carregando, erro de rede |

## Estados cobertos (fase B)
| Tela | Estados |
|---|---|
| B1 Nicho | padrão, palavra adicionada (salva na hora, com "Desfazer"), palavra repetida, teste "passaria", teste "não passaria", sem palavras do nicho, erro ao salvar, carregando, erro de rede |
| B2 Horários e limites | padrão, alterado e não salvo (barra de salvar), erro de validação embaixo do campo, salvo, carregando, erro de rede |
| B3 Conta Amazon | padrão (em uso), tag inválida, confirmação de troca, salva, sem tag, carregando, erro de rede; Mercado Livre aparece como "próxima fase" |
| B4 Avisos | notificações desligadas, ligadas, teste enviado, bloqueado pelo navegador, iPhone sem o painel instalado, carregando, erro de rede; reservas (WhatsApp, e-mail) e resumo do dia |
| B5 Primeira configuração | passo 1 a 5 (WhatsApp, grupo das ofertas, grupos de origem, nicho, tag), passo 2 sem nenhum grupo, concluído com o modo teste ligado |

Decisões da fase B: no B1, cada palavra é salva ao adicionar ou remover, com "Desfazer" (não há botão "Salvar" para esquecer). No B2, a barra de salvar só aparece quando algo muda, e uma frase resume o efeito dos números. No B3, trocar uma tag que já está em uso pede confirmação.

**Pergunta em aberto para o Tech Lead:** a janela de horário pode passar da meia-noite (ex.: das 18h às 1h)? Hoje o código recusa. O protótipo não mostra esse caso.

Horários sempre em 24 h (pt-BR). A janela pode passar da meia-noite, e a frase diz "das 18h às 2h do dia seguinte".

## Para quem implementa
- Importe `styles/tokens.css` e `styles/componentes.css` em `main.tsx`, antes do `index.css` atual. O prefixo `.ml-` evita conflito com o CSS antigo durante a migração.
- Fonte: adicione `@fontsource-variable/archivo` e importe `@fontsource-variable/archivo/wdth.css` (o eixo de largura é necessário). Não use CDN, para o PWA funcionar offline. **O protótipo carrega a fonte do Google Fonts só por conveniência.**
- O zoom já foi liberado no PR #3. Troque o `theme-color` do `index.html` e do manifesto para `#f1f3f9` (o fundo).
- Classes `.ml-` vêm de `componentes.css`. A seção "Pele v2", no fim do arquivo, vale sobre a base; não a separe.
- Notas do TL no PR #7, para a adoção:
  - Em Android de entrada, o `backdrop-filter` pode pesar ou não existir. Use `@supports not (backdrop-filter: blur(1px))` para dar à barra um fundo opaco (`#ffffff` com a mesma borda e sombra).
  - Unifique os dois blocos de `prefers-reduced-motion` (o de `tokens.css` e o do fim de `componentes.css`) quando migrar.
  - Remova o CSS antigo (`index.css`, classes sem `.ml-`) de cada tela à medida que ela for migrada.
- A faixa de modo teste (`.ml-aviso--teste`) fica fixa no topo, acima da faixa de sinal.
- Os dados dos protótipos são **exemplos** (nomes de grupos, preços, horários, número +55 11 91234-5678). Não copie para o código.
- O código de pareamento e o QR nunca entram no cache do service worker.

## Ainda falta (próximas entregas do UX)
- Fase C: esboço do fluxo de renovar o login do Mercado Livre, depois da PoC.

## Pele v2: regras visuais
- **Cantos:** 16 px em botões e campos, 18 px em cartões de lista, 28 px em folhas e 32 px na faixa de sinal e na sidebar. Chips são pílulas.
- **Profundidade:** cartões sem borda, com `--sombra-1`. No hover, sobem 1 px com `--sombra-2`. A barra usa `--sombra-nav`. Não empilhe mais de 2 camadas.
- **Faixa de sinal:** é um cartão grande com brilho radial da própria cor e uma sombra colorida embaixo. O texto sobre a faixa vem de `--cor-sobre-*`.
- **Botão secundário dentro de cartão:** usa o fundo do chão (`--cor-chao`) para não sumir no branco.

## Pele v2: regras de movimento
| O quê | Como | Duração e curva |
|---|---|---|
| Troca de estado da faixa | só a cor de fundo e a sombra mudam; a frase entra com fade | 320 ms, `--curva-saida` |
| Aba ativa | uma única pílula desliza entre as abas (`transform: translateX`); no protótipo, ela aparece parada | 320 ms, `--mola` |
| Toque em botão | `scale(0.96)` enquanto pressiona | 220 ms, `--mola` |
| Chip adicionado | entra de `scale(0.85)` e opacidade 0 | 260 ms, `--mola` |
| Números do dia | contam de 0 até o valor ao abrir o Início (`.ml-conta` com `@property --n`); no app, use JS e mantenha o número real no texto para leitores de tela | 900 ms, `--curva-saida` |
| Troca de tela | View Transitions: a tela sai subindo 6 px e a nova entra subindo de 10 px. No SPA, use `document.startViewTransition()` | 180 ms saída, 260 ms entrada |
| Item resolvido | sai deslizando 24 px para a direita | 200 ms |
| Folha de confirmação | sobe de baixo (celular) ou aparece com fade (computador) | 320 ms, `--mola` |

Regras:
- Anime só `transform`, `opacity` e a cor da faixa.
- Nada se move sozinho sem motivo: não há animação de entrada em cada cartão, nem pulsar contínuo.
- Com `prefers-reduced-motion: reduce`, tudo é instantâneo e os números já aparecem no valor final.

## Histórico das paletas
`docs/design/paletas/` guarda as 3 opções apresentadas (Nanquim, Cobalto e Noturno), com `contrastes.json`. A Cobalto foi a escolhida e já está em `tokens.css`. A Noturno fica guardada para um futuro tema escuro opcional (fora do escopo atual). As pranchas dessa pasta carregam a pele da época e servem só como registro.
