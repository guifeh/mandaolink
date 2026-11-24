# P1 — pipeline Amazon

`runPipeline(input, config, deps)` roda G0–G8 em ordem e encerra em REPROVA **ou ADIA**. Cada resultado é persistido por `deps.record`; falha de persistência aborta o processamento. `runBeforeSend(queuedOffer, deps)` executa G9 na saída da fila, não na ingestão, e refaz G4/G6 após 30 minutos desde a leitura. O TTL de duas horas conta desde a captura e também limita a permanência na fila.

Os gates são funções puras: dados externos entram como snapshots. Leitor, resolver, relógio, último envio, persistência, nicho e template são dependências explícitas. O contrato `ProductReader.read(asin)` é estruturalmente compatível com S1; os testes usam fake, sem navegação externa. Nicho e template usam as implementações reais de J3/J1.

O resolver foi adaptado do PoC do Tech Lead: segue apenas `Location`, cancela o corpo e para assim que extrai o ASIN, antes de abrir a URL com tag de terceiro. Limita cinco requests, dez segundos totais, não envia cookies e recusa protocolos/portas/credenciais ou destinos fora da lista. Uma URL com parâmetro de afiliado sem ASIN é recusada sem abrir. G7 constrói e compara a URL exata com a tag do cliente; não faz request.

G3 consulta o último envio por loja+produto+destino: janela padrão de 24 h, reenvio por queda de preço opcional. Apenas nessa exceção G3 antecipa a leitura para comparar preços; o caso comum faz dedup antes da leitura. O preço anterior vem do snapshot de `envios`, nunca do cadastro mutável `ofertas`.

`apps/api/src/pipeline-store.ts` implementa gravação transacional de cada evento, criação canônica da oferta quando G2 resolve o produto e atualização dos dados oficiais após gates aprovados. Eventos anteriores ao ASIN ficam sem oferta vinculada. As mensagens precisam ter sido inseridas pelos conectores; `mensagens_brutas.conteudo` admite apenas `texto` e `link`, sem dados do autor. Identificadores/horários/preço anunciado ficam nas colunas específicas.

## Avaliação

```powershell
npm run build
npm test -w packages/core
npm test -w apps/api
```

Em 23/11/2026: 52 testes do core passaram; a avaliação executou G0–G9 sobre **45 exemplos sintéticos**, com **45/45 decisões e 45/45 motivos corretos**, zero falsos positivos e negativos. O adapter nunca lê `esperado`: só usa entradas da mensagem/contexto, fake de leitura e fake de HTTP. `contexto.agora` é o instante de ingestão e `tempoNaFilaMinutos` avança o relógio antes do G9. Imagens/redirects são sintéticos. Isso verifica regras, não estima a taxa real de ofertas ruins nem substitui o ensaio com fontes autorizadas.

Rulings: G9 separado da ingestão para não testar validade antes da espera; ADIA interrompe o pipeline para não publicar informação ainda não validada; categoria só é avaliada quando informada, conforme o plano. O TTL desde a captura evita renovar uma oferta antiga ao reenfileirar.

Revisão P3 incorporada na migração 002: `ofertas.id_loja`, snapshots de preço/data/imagem em envios, preço anunciado, índices, tag estrita e `descartado` terminal com motivo. Logs continuam imutáveis por decisão do TL; retenção fica para tarefa própria. Migrações/API validadas em PostgreSQL embutido PGlite; container e concorrência entre processos continuam fora da verificação enquanto o Docker está parado, por orientação do TL.


Revisão de integração: G4 respeita retryAt futuro e usa reverAposMs para a validade do snapshot. Ingestão e fila devem compartilhar UMA instância ProductReader por processo (ritmo e pausa por captcha são estado dessa instância). O worker recebe essa instância, sem criar outro leitor. Evidências atualizadas: docs/evidence-p1-p2-api-2026-11-23.md.
