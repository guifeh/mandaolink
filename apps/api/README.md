# API e banco — P3

Node 24, TypeScript, Fastify e PostgreSQL. Execute os comandos na raiz do monorepo.

```powershell
npm ci
npm run build
npm test
```

O ambiente Docker e suas variáveis ficam na J4/README da raiz. Para execução direta, defina `DATABASE_URL`, `OWNER_EMAIL`, `APP_ORIGIN`, `PORT` (3000) e `HOST` (127.0.0.1). O cookie usa HTTPS por padrão; `COOKIE_SECURE=false` serve apenas para desenvolvimento HTTP local. A API e o painel devem compartilhar a mesma origem (proxy no desenvolvimento).

```powershell
npm run migrate
npm start
```

`db/migrations/*.sql` são aplicadas em ordem, uma transação por arquivo. `schema_migrations` registra as versões e um advisory lock serializa execuções concorrentes. Não altere migrações já aplicadas: acrescente outra numerada. O runner funciona tanto via `tsx` quanto compilado (`node apps/api/dist/migrate.js`). Não há rollback destrutivo automático.

## HTTP

| Método e caminho | Corpo / consulta | Resultado |
|---|---|---|
| GET /saude | — | 200 com banco acessível; 503 caso contrário |
| POST /auth/link | `{ "email": "email-do-dono" }` | 202 neutro, limitado a 5 pedidos/min/IP |
| POST /auth/verificar | `{ "token": "64 caracteres hexadecimais" }` | Consome link; cria cookie `sessao` |
| POST /auth/sair | — | Revoga sessão; 204 |
| GET /config | — | Configuração única, incluindo pausa |
| PUT /config | Objeto completo abaixo | Atualiza nicho/limites/horários/tag |
| PUT /pausa | `{ "pausado": true }` | Persiste pausa geral |
| GET /historico | `pagina=1&limite=20` (máximo 100) | Eventos e envios paginados, mais recentes primeiro |
| GET /pendencias | — | Até 100 exceções abertas e 100 envios falhos/incertos |

Todos os endpoints fora de `/auth/*` e `/saude` exigem o cookie. Escritas rejeitam `Origin` diferente de `APP_ORIGIN`; sem CORS. Cookies HttpOnly, SameSite Strict; respostas sem cache. Campos desconhecidos e valores fora do schema são rejeitados.

Exemplo sintético de `PUT /config`:

```json
{
  "nome": "Carro",
  "palavras_chave": ["carro"],
  "palavras_bloqueadas": ["brinquedo"],
  "categorias": [],
  "tag_amazon": "exemplo-20",
  "limite_hora": 5,
  "limite_dia": 30,
  "horario_inicio": "08:00",
  "horario_fim": "22:00"
}
```

Horários no fuso America/Sao_Paulo; nesta versão, janelas não atravessam a meia-noite. Leituras de horários retornam o formato Postgres `HH:MM:SS`; escritas recebem `HH:MM`. O sistema começa pausado, sem palavras autorizadas e sem tag de afiliado.

## Link mágico

Somente `OWNER_EMAIL` recebe links; não existe cadastro de usuários. Tokens de 256 bits ficam apenas como SHA-256 no banco, duram 15 min e são consumidos atomicamente uma vez. Sessões duram 30 dias e são revogadas no logout. O link usa fragmento (`/login#token=...`) para evitar token em URL de requisição; a futura PWA deve lê-lo, removê-lo do endereço e enviar por POST.

**O transporte de e-mail é stub intencional:** `server.ts` não envia nem imprime links. A resposta 202 não significa entrega e o login interativo não está operacional até integrar `sendMagicLink` em `buildApp`. Os testes injetam um destinatário em memória para validar o fluxo completo. Não há endpoint de debug nem bypass de autenticação.

## Modelo e integração com os workers

- `fontes`: fonte única por plataforma+identificador; só pode ficar ativa com `autorizada_em` preenchida.
- `mensagens_brutas`: conteúdo original JSON; unicidade fonte+mensagem externa; updates/deletes recusados pelo banco.
- `ofertas`: cadastro canônico Amazon por loja+ASIN; preço em centavos, título/imagem/preço da página oficial e instante da verificação. O pipeline é responsável por essa proveniência.
- `eventos_oferta`: PASSA/REPROVA/ADIA por mensagem/gate; motivo nas negativas e próxima tentativa em ADIA. `oferta_id` pode ser nulo antes de resolver o produto (G0–G2). Log imutável.
- `envios`: chave de idempotência única e apenas um pendente por produto+destino. `na_fila` pode ir para `enviado`, `falhou`, `incerto` ou `descartado` (terminal com motivo); `incerto` pode virar `enviado`, ou `falhou` somente com prova de não transmissão registrada no evento. Confirmação repetida preserva ID e horário já conciliados. Nunca retorne um incerto à fila. Janela de dedup de 24 h, expiração em 2 h, limites, reconciliação em 10 min e decisão de retry são responsabilidades de P2/S4; os índices suportam suas consultas.
- `config_nicho`: singleton, nicho/tag/limites/horários e pausa persistente. Workers devem consultar a pausa antes de qualquer envio.
- `excecoes`: pendências operacionais abertas até `resolvida_em`.

IDs UUID; timestamps com fuso; FKs sem cascata destrutiva. Não há conector, worker, tela ou envio externo nesta task.

## Testes

`npm test` roda a mesma migração SQL em PostgreSQL embutido (PGlite), sem serviço externo, e exercita a API com `Fastify.inject`. Não simula as consultas SQL. Apenas o advisory lock é ignorado nesse backend de conexão única.

Para executar os mesmos testes num PostgreSQL de rede, use **um banco vazio e descartável** e defina `TEST_DATABASE_URL`. O teste cria registros sintéticos e não limpa o banco; nunca aponte para o banco de operação.

```powershell
$env:TEST_DATABASE_URL = 'postgresql://usuario:senha@localhost:5432/mandaolink_test'
npm test
Remove-Item Env:TEST_DATABASE_URL
```

A suíte cobre migração do zero/reexecução, dedup, autorização de fonte, imutabilidade, transições de envio, link único/expirado, sessão/logout, proteção de origem, limites de login, configuração, histórico e pendências. Execução Docker/Postgres de rede deve ser registrada separadamente da execução PGlite.


Para Cloudflare Tunnel, configure TRUSTED_TUNNEL_PROXIES com os peers confiáveis conforme Compose/J5. Sem configuração, headers de proxy não são confiáveis. HEARTBEAT_URL vazia desliga monitoramento; configurada, agenda ping a cada 5 minutos após verificar o banco. Nenhum monitor externo é provisionado por esse código. Veja docs/evidence-p1-p2-api-2026-11-23.md para testes e limites atuais.
