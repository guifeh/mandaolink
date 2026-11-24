# P5 — processo integrado e ensaio

`npm start` sobe apps/api/dist/server.js: migrações, uma instância de leitor, HTTP, heartbeat, ingestão persistida e worker pg-boss. Requer Postgres operacional; não foi iniciado em Docker nesta entrega.

Defaults: `CONNECTORS=fake`, `DRY_RUN=true`. Fake força ensaio mesmo com DRY_RUN=false. Nenhuma chamada ao Publisher externo acontece no ensaio: a confirmação grava `envios.simulado=true` e evento `envio_simulado`. A marca existe desde o enqueue. Fila real não escolhe itens simulados. `enviado` com simulado=true significa apenas simulação; o painel deve mostrar essa diferença.

Fake injeta as 45 fixtures uma vez por fonte+ID, com timestamps atuais e leitor/redirects sintéticos, sem rede. Não reproduz o relógio e todos os contextos da avaliação P1; serve ao fluxo operacional. Não altera nicho/tag/pausa existentes. Configure tag e palavras via painel/API e retire a pausa para testar a fila. A configuração inicial permanece pausada; entradas aguardam configuração, sujeitas à validade original ao retomar.

`runtime.ts` expõe SourceConnector.start(accept)/stop, IncomingMessage e RuntimeConnectors. O conector só confirma recebimento após accept resolver; accept persiste mensagem e item de ingestão na mesma transação. Não passe remetente/telefone nem inclua esses dados no texto. sourceId é UUID de fonte previamente cadastrada/autorizada. ADIA persiste tentar_em; falhas deixam ingestão pendente. Reprocessamento pode repetir eventos após crash, mas idempotência/unicidade impedem duplicar o envio. QueueStore e worker usam a mesma instância de ProductReader fornecida ao runtime; não crie um leitor para cada caminho.

`CONNECTORS=real` falha fechado no entrypoint até registrar adapter S2/S3. O ponto de encaixe é startRuntime({connectors:{source,reader,publisher},destination,...}); a criação de UMA instância S1 pertence a esse adapter. Somente DRY_RUN=false permite chamar o publicador injetado. Essa configuração não substitui autorização do TL para conectar/enviar.

No shutdown: parar fonte, esperar processamento em andamento, parar pg-boss graciosamente, fechar leitor e banco; heartbeat/timers encerrados. Itens não processados e na_fila permanecem no banco; envio interrompido após reserva fica incerto e exige conciliação, sem retry cego. Wake do pg-boss vem de timer externo ao job, evitando que singleton ativo suprima o próximo tick.

Teste `apps/api/test/runtime.test.ts`: PGlite do zero, fonte fake das fixtures → pipeline → SQL → callback do worker → G9 → confirmação simulada/evento; Publisher externo injetado lança se chamado (zero chamadas); replay não duplica entradas; shutdown preserva fila, fecha fonte/leitor/boss e recusa nova entrada. Relógio, HTTP e boss falsos. Não comprova banco TCP, pg-boss real ou garantia de entrega do conector externo.
