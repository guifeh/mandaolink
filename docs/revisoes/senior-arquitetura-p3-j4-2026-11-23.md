# Revisão do Dev Senior — arquitetura, P3 e J4

Data: 23/11/2026. Base: plano v1, backlog v1, código em `Shared/mandaolink` nesta data e medições da S1 (`packages/connectors/amazon/reports`).
Legenda: **[B]** bloqueia ou custa caro mudar depois · **[M]** corrigir antes da F3 · **[m]** melhoria.

---

## 1. Arquitetura

### 1.1 Monólito modular + pg-boss — **serve. Mantenho.**
Volume real: ~30 envios/dia e algumas centenas de mensagens/dia. Postgres + 1 processo Node aguenta com sobra.
O que eu mudaria:
- **[M] Uma fonte de verdade para o envio.** A P3 já tem `envios.estado`. Se o P2 também guardar o estado no job do pg-boss, teremos dois estados divergindo. Regra: `envios` é a verdade; o publicador é **um worker singleton** que pega o próximo `na_fila` com `FOR UPDATE SKIP LOCKED`. pg-boss fica só para agendar (ADIA com `tentar_em`, sondas, resumo diário, G9) e retry de etapas do pipeline.
- **[m] Navegador fora do caminho crítico.** Com o achado da S1 (abaixo), o Chromium vira fallback, iniciado sob demanda. Se crescer, isola em processo próprio (crash/memória do Chromium não derruba o publicador).
- Sem Redis, sem microserviço, sem fila externa. Concordo com o plano.

### 1.2 Baileys direto ou Evolution API — **Baileys direto, atrás do adapter.**
- Evolution é Baileys por dentro: **mesmo risco de ban**, mais um container, banco/Redis próprios, REST + webhook para monitorar. Ganho dela (multi-instância, painel de QR) não usamos com 1 número.
- Condições: fixar a versão exata do Baileys, guardar o auth state cifrado (não em arquivo solto), teste de fumaça no grupo de teste antes de qualquer upgrade. Evolution/provedor pago continua como plano B, o adapter já cobre a troca.

### 1.3 Leitura da Amazon — **mudar: fetch primeiro, Playwright só como fallback.**
Medido hoje, rede local, nicho Carro:

| Via | Amostra | Publicável | Tempo médio | p95 |
|---|---|---|---|---|
| fetch simples em `/dp/{ASIN}` | 30 ASINs reais | 30/30 | 1,9 s | 2,3 s |
| Playwright (Chromium headless) | mesmos 30 | 30/30 | 2,1 s | 2,6 s |

- O 503 do achado anterior foi na **busca** (`/s`), não na página de produto. Para `/dp/`, fetch passou 30/30.
- **Achado importante:** forçar `userAgent` no Playwright (Chrome 142 num Chromium 159) dá **captcha na 1ª página**; sem forçar, passa. UA “fixo” = fixar a versão do Playwright, não sobrescrever o UA.
- Escala: precisamos de ~20–60 leituras/h (ASINs únicos após G3 + releituras do G9). Resultado do teste de taxa por hora no relatório da S1.
- Implementado: leitor com ritmo 2–4 s serializado, fallback para navegador em bloqueio, **pausa de 30 min** se os dois bloquearem (G4 devolve ADIA, sem martelar).
- **[M] Cache por ASIN de 10–15 min** no G4: a mesma oferta chega de várias fontes em minutos; corta leituras pela metade.
- **[B] Migração para VPS:** o resultado vale para **IP residencial**. IP de datacenter costuma ser muito mais bloqueado pela Amazon. Refazer o bench da S1 na VPS **antes** de migrar; se falhar, o leitor fica numa máquina com IP residencial.

### 1.4 Modelo de dados (P3) — ver seção 2. Resumo: base boa; 3 ajustes estruturais antes de o P1 escrever em cima.

### 1.5 Riscos que ficaram de fora do plano
1. **[B] G2 abre link de afiliado de terceiros.** Para tirar o ASIN de um `amzn.to` de terceiro, o resolver **precisa** fazer a requisição ao encurtador — é justamente esse hop que registra o clique para o afiliado alheio. O rascunho para antes da URL final, mas o hop do encurtador já aconteceu. Isso conflita com a regra “não abrir link de afiliado de terceiros”. Decisão necessária do Guilherme: aceitar 1 requisição sem cookies por link (o que dá para fazer) ou só aceitar mensagens com URL `amazon.com.br/dp/...` explícita (perde a maioria das ofertas). Minha recomendação: aceitar, documentado, sem cookies e sem seguir para a URL final.
2. **[B] PWA no celular precisa de HTTPS público até o PC de casa.** Web Push e service worker exigem HTTPS; o PC está atrás de NAT/CGNAT. Falta no plano: túnel (Cloudflare Tunnel ou Tailscale Funnel). Sem isso não existe “renovar/parear pelo celular” nem push.
3. **[B] Monitor de uptime não alcança o PC de casa.** Usar heartbeat de **saída** (o app faz ping a cada 5 min num serviço tipo healthchecks; o serviço avisa quando o ping para). Monitor que faz requisição para dentro não funciona sem túnel.
4. **[M] Docker Desktop só sobe depois do login no Windows.** Reinício do Windows Update = sistema parado até alguém logar. Precisa de logon automático (ou Docker Engine no WSL como serviço) e BIOS em “ligar ao voltar energia”. O README da J4 afirma que “volta sozinho”, o que só é verdade após login.
5. **[M] LGPD em `mensagens_brutas`.** Grupos de WhatsApp trazem nome e telefone de quem postou. Guardar só texto, URLs e horário; **não** o remetente. E o log imutável hoje também impede apagar por retenção (seção 2).
6. **[M] Preço com cupom.** A fonte costuma anunciar o preço **com cupom**; a página mostra sem cupom. G6 com 5% de tolerância vai reprovar muitas ofertas legítimas. Não piora a qualidade (falha fechada), mas derruba o volume. Medir no ensaio antes de inventar parser de cupom.
7. **[m] Variação de ASIN.** A Amazon pode responder a página de outra variação. O leitor já devolve `pageAsin` (canonical); o G4 deve reprovar se diferir.
8. **[m] Fuso.** “preço às HH:MM” precisa de `TZ=America/Sao_Paulo` nos containers.

---

## 2. Revisão da P3 (modelo de dados + API)

Pontos fortes: unicidade fonte+mensagem e loja+asin, `CHECK` de fonte ativa só com autorização, transições de envio por trigger, `incerto` só promove para `enviado`, índice parcial de 1 pendente por oferta/destino, magic link hasheado, uso único por `DELETE ... RETURNING`, cookie HttpOnly/Strict, migração transacional com lock. Bom trabalho.

**Bloqueadores (antes do P1/P2):**
1. **[B] `envios` não tem estado para descarte na fila.** G9 (“vencida na fila”), TTL de 2 h e pausa precisam tirar item de `na_fila` sem ser `falhou`. Hoje `na_fila` só vai para `enviado|falhou|incerto`. Adicionar `descartado` (com `motivo`), transição `na_fila → descartado`.
2. **[B] `ofertas` mistura produto e oferta.** Com `UNIQUE(loja, asin)` e preço/título mutáveis, cada leitura sobrescreve a anterior: perde-se o histórico e o preço que justificou cada envio (necessário para medir “<2% ruins”). Sugestão mínima: manter a tabela como **produto** (último retrato) e gravar em `envios` o `preco_centavos`, `preco_lido_em` e `imagem_url` usados na mensagem. Sem isso a auditoria do ensaio não fecha.
3. **[B] Falta o preço anunciado pela fonte** (insumo do G6). Hoje só existe dentro do `conteudo` jsonb. Precisa de coluna (`preco_anunciado_centavos`) no candidato (mensagem × produto) — pode ser em `mensagens_brutas` ou numa tabela `candidatos`.
4. **[B] Retenção impossível.** O trigger bloqueia `DELETE` em `mensagens_brutas` e `eventos_oferta`, e as FKs não têm `ON DELETE`. Com dado pessoal (LGPD) e disco do PC local, precisamos apagar após N dias. Proposta: trigger bloqueia só `UPDATE`; `DELETE` só por job de retenção (papel/flag de sessão), com `ON DELETE CASCADE` de mensagem → eventos.

**Corrigir antes da F3:**
5. **[M] Índice de `eventos_oferta(mensagem_bruta_id, criado_em DESC)`.** “Último resultado de cada mensagem” (ADIA a reprocessar, pendências) hoje varre o log.
6. **[M] `excecoes` sem deduplicação.** Cada sonda que falhar abre uma exceção nova → tempestade de avisos. Índice único parcial em `(tipo, coalesce(fonte_id::text,''))` `WHERE resolvida_em IS NULL`.
7. **[M] `tag_amazon` aceita vazio e qualquer formato.** Validar `^[a-z0-9][a-z0-9-]{1,30}-20$` (mesma regra do G7) e o G7 falhar fechado se vazia.
8. **[M] Nome `asin` + `CHECK (loja='amazon')`.** Quando o ML entrar, vira migração com rename. Mais barato agora: `id_loja` (ASIN/MLB) mantendo o `CHECK` de formato por loja.

**Melhorias:** `horario_inicio < horario_fim` impede janela que passa da meia-noite (ok para v1, documentar); limpeza de `auth_sessoes` expiradas; índice `mensagens_brutas(fonte_id, publicada_em DESC)` para o alerta “fonte quieta”.

---

## 3. Revisão da J4 (Docker Compose e ambiente local)

**Bloqueadores:**
1. **[B] Postgres exposto na rede.** `5432` publicado em todas as interfaces, com senha padrão `postgres` como fallback. No PC ligado 24 h em rede doméstica, qualquer um na LAN entra. Tirar o `ports` do Postgres (o app fala pela rede interna) ou `127.0.0.1:5432:5432`; e `POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?defina no .env}` sem default. Mesmo para `OWNER_EMAIL`.
2. **[B] `.dockerignore` só ignora `node_modules` da raiz.** `COPY . .` leva qualquer `node_modules`/`dist` aninhado (o `packages/connectors/amazon/node_modules` já existe) do Windows para a imagem Linux: binários nativos errados e imagem grande. Usar `**/node_modules`, `**/dist`, `**/.profile-*`, `**/reports`.
3. **[B] Backup no mesmo disco.** Se o disco do PC morrer, vão banco e backups juntos. Copiar o dump para fora (pasta do OneDrive/Google Drive sincronizada ou USB) e **testar o restore** num banco temporário (`createdb restore_teste` + `pg_restore`) — hoje o restore está documentado, mas nunca foi executado.

**Corrigir:**
4. **[M] README “volta sozinho após reinício”**: só depois do login (ver 1.5 item 4). Documentar logon automático e BIOS.
5. **[M] `npm install` → `npm ci`**, e `package-lock.json` obrigatório (o `*` no `COPY` tolera ausência → build não reprodutível).
6. **[M] `TZ=America/Sao_Paulo`** nos dois serviços.
7. **[M] App em `0.0.0.0:3000` com `COOKIE_SECURE=false`.** Ok em dev; em produção, publicar só `127.0.0.1:3000` e expor pelo túnel HTTPS.
8. **[m]** `backup.ps1` ignora o `.env` (usuário/banco fixos); a tarefa agendada roda só com usuário logado (ok se houver logon automático).
9. **[m]** Workspaces `packages/*` não incluem `packages/connectors/*` — adicionar quando o pipeline importar o conector Amazon.
10. **[m]** Quando o navegador entrar na imagem: base com dependências do Chromium (ou imagem do Playwright) e `shm_size: 1gb`. Com fetch primeiro, dá para deixar o navegador opcional.
