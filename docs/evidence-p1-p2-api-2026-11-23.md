# P1, P2 e ajustes da API — evidências

Validação em 23/11/2026, Node 24.22.3. Comando na raiz:

```powershell
npx --yes --package=node@24 --call "npm test"
```

Build do core e da API aprovado; 52 testes do core e 25 da API aprovados, sem falhas. Migrações 001–004 aplicadas do zero e reaplicadas em PGlite (PostgreSQL embutido). Isso não valida Docker, transporte TCP, locks entre processos ou pg-boss com banco real.

P1: G0–G9, persistência dos resultados, dedup e queda opcional, cupom no preço efetivo apenas para comparação, preço integral na mensagem, resolver sem abrir link afiliado e G9 na saída. Nicho/template reais de J1/J3; leitura e HTTP falsos nos testes. As 45 fixtures sintéticas tiveram 45/45 decisões e motivos corretos, zero falsos positivos/negativos; contadores G6: 2 ofertas vencidas e 1 cupom ilegível. Não é medição de qualidade em produção.

P2: fila prioriza novas, respeita limites, horário de São Paulo, pausa, intervalo aleatório 3–8 min e TTL. Reserva `incerto` antes de chamar Publisher; falhas ambíguas não voltam à fila. Falha comprovadamente anterior à transmissão registra prova ligada ao envio antes de liberar `falhou`. Preço/data/imagem e snapshot ficam preservados. Testes cobrem relógio simulado, SQL real embutido e adapter pg-boss falso.

Revisão sênior incorporada: `descartado` terminal com motivo, preço anunciado separado, `id_loja`, índices e tag estrita. Retenção permanece adiada por decisão do TL; logs continuam imutáveis. Conteúdo bruto só aceita chaves texto/link; conectores ainda precisam evitar dados pessoais dentro do texto.

Ajustes da segunda revisão: `confirmed()` aceita registro já enviado e preserva ID/horário do eco; ID inexistente continua falhando. G4 usa retryAt futuro do leitor, com fallback de 5 min; validade e releitura usam reverAposMs (padrão 30 min). Regressões verificadas na suíte.

API: trustProxy restrito a TRUSTED_TUNNEL_PROXIES; CF-Connecting-IP só influencia rate limit quando o peer é confiável. Headers falsos no acesso direto não evitam limite. APP_ORIGIN define link e proteção de origem; COOKIE_SECURE controla cookie. HEARTBEAT_URL vazia desliga; configurada agenda ping a cada 5 min, verifica banco antes, evita sobreposição e encerra no shutdown. HTTP/relógio falsos; nenhum ping externo executado.

Integração pendente: bootstrap de ingestão/fila deve criar UMA instância ProductReader S1 por processo e passar a mesma referência a ambos. startQueueWorker recebe reader por injeção e não cria leitores. A API server.ts inicia só HTTP/heartbeat; worker/conectores reais não foram ativados. Compartilhar instância limita ritmo/captcha; não substituir por duas instâncias independentes. Revisão final desse bootstrap fica com TL/Senior.

Arquivos principais: packages/core/src/{gates,pipeline,pipeline-types,resolve,send-queue}.ts; apps/api/src/{pipeline-store,queue-store,queue-worker,app,heartbeat,server}.ts; db/migrations/002–004; testes em packages/core/test e apps/api/test.

Não executados por orientação do TL: Docker e envio real. Nenhuma conta, conexão de número, publicação, commit ou push. Build regravou dist; testes usaram dados sintéticos em memória. Este relatório e READMEs foram atualizados.
