# P2 — fila de envio

`envios` é a fonte de verdade; pg-boss apenas acorda o dispatcher. `startQueueWorker` recebe instâncias de pg-boss, Pool, ProductReader e Publisher. O bootstrap normal da API **não inicia esse worker nem conecta um publicador**. A futura S2 integra o conector autorizado; os testes usam fakes.

- `createQueueStore(...).enqueue(...)` exige resultado aprovado G0–G8, snapshot válido e evento da oferta já persistido. Deduplica por loja+produto+destino, janela móvel de 24 h e exceção opcional de queda; a chave estável inclui mensagem de origem, produto e destino. Banco também garante um único pendente por produto/destino. Repetir a mesma ingestão não cria novo envio.
- `dispatchNext` usa lock global PostgreSQL e seleciona o `na_fila` mais recente e elegível. O estado do job pg-boss não é o estado do envio.
- Janela local America/Sao_Paulo, início inclusivo/fim exclusivo. Limite por hora móvel e dia civil local. Tentativas reservadas contam conservadoramente, incluindo incertos, para não ultrapassar a capacidade após um timeout.
- Intervalo sorteado de 3 a 8 minutos entre inícios das tentativas, persistido em `controle_fila` antes da chamada externa. Restart não zera contadores nem intervalo.
- Pausa é lida de `config_nicho.pausado`, a mesma coluna escrita por `PUT /pausa`. Há nova leitura após G9 e condição no UPDATE de reserva. Ofertas já reservadas são tentativas em andamento; pausar impede novas reservas, sem prometer cancelar uma transmissão iniciada.
- TTL de 2 h desde captura; expiração descarta com motivo e evento G9, inclusive durante pausa. G9 refaz a leitura depois de 30 min e revalida nicho/preço/link/template. ADIA guarda `nao_antes_em` e permite processar outras ofertas.

## Contrato do publicador

`Publisher.send({ destinoId, texto, mediaUrl, idempotencyKey }, signal)` retorna:

```typescript
type PublishResult =
  | { status: 'enviado'; mensagemId: string }
  | { status: 'incerto'; motivo: string }
  | { status: 'falhou'; naoTransmitido: true; motivo: string };
```

Antes da chamada, a reserva grava `incerto`, snapshot e horário da tentativa. ACK promove a `enviado`; exceção, timeout de 30 s ou resposta ambígua mantém `incerto`. Esses registros nunca voltam para `na_fila` e não são reenviados pelo retry do job. O conector deve respeitar `AbortSignal` e a chave de idempotência.

`naoTransmitido:true` só pode ser usado com prova de falha **anterior** à transmissão, como sessão ausente ou validação local. Nesse caso a transição `incerto→falhou` grava flag e prova no evento, ligada ao envio. Trigger diferido exige a prova no commit; `mensagem_externa_id` precisa estar ausente. Um erro genérico nunca autoriza essa transição. Falhas não são reenfileiradas automaticamente nesta camada; a S4 cuida dos disjuntores/reconciliação.

`descartado` é terminal e exige motivo. Snapshot/texto/chave/destino ficam imutáveis após a reserva. Migrações 002–004 implementam essas regras; nenhuma rotina de retenção ou DELETE foi criada.

## Testes e verificação

```powershell
npm test
```

Testes do core usam relógio/sorteio/publicador falsos e cobrem ordem, limites, janela, intervalo 3/8 min, pausa durante validação, TTL, ADIA, falta de ACK e duas chamadas concorrentes. Testes SQL usam PGlite para dedup, reserva, snapshots, hora móvel/dia local, descarte auditado, pausa/fonte e prova de pré-transmissão. O adapter pg-boss tem teste de contrato com fake de seus métodos.

Limite conhecido de verificação: pg-boss com PostgreSQL de rede, locks concorrentes reais e operação entre processos não foram executados; Docker segue pendente por decisão do TL. Para isso, usar banco descartável via `TEST_DATABASE_URL` e testar o worker com Publisher falso antes de conectar a S2. Nenhum envio real foi feito.
