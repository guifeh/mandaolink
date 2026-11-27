# @mandaolink/connector-telegram (S3)

Leitor de fontes do Telegram. **Só lê, nunca envia.** Dois caminhos:

| Fonte | Leitor | Como | Requisito |
|---|---|---|---|
| Canal ou grupo onde o dono adicionou o nosso bot | `createBotSource` | Bot API, long polling em `getUpdates` | `TG_BOT_TOKEN` (BotFather). Em grupo, o bot precisa ser admin ou ter o modo de privacidade desligado |
| Canal público sem bot | `createMtprotoSource` + `createGramjsClient` | Conta de usuário via MTProto (GramJS `telegram` **2.26.22, versão exata**), só eventos de mensagem nova | `TG_API_ID`, `TG_API_HASH`, sessão já autenticada e um número próprio |

Os dois emitem a mesma `SourceMessage` do conector WhatsApp (S2), com `plataforma: 'telegram'`:
`{ plataforma, grupoExternoId, mensagemExternaId, texto, publicadaEm }`. Não há remetente, nome, username nem telefone de quem postou (LGPD).

> Nada aqui conecta conta ou número sem a PoC-TG aprovada. Os testes usam `fetch` e cliente MTProto mockados.

## Uso

```ts
import { createBotSource, createMtprotoSource, createGramjsClient, createPgExceptionSink,
  loadSession, parseSessionKey } from '@mandaolink/connector-telegram';

const exceptions = createPgExceptionSink(pool);
const fontes = async () => idsExternosDasFontesTelegramAtivas(); // fontes.identificador_externo

const bot = createBotSource({ token: process.env.TG_BOT_TOKEN!, fontes, exceptions });

const session = await loadSession('./data/tg.session.enc', parseSessionKey(process.env.TG_SESSION_KEY));
const conta = createMtprotoSource({
  client: createGramjsClient({ apiId: Number(process.env.TG_API_ID), apiHash: process.env.TG_API_HASH!, session: session! }),
  canais: fontes,
  exceptions,
});

for (const s of [bot, conta]) s.onMessage((m) => { /* SourceMessage → IncomingMessage */ });
await bot.start(); await conta.start();
```

**Para o adapter de ingestão (P5/P6, `apps/api/src/runtime.ts`):** `IncomingMessage.sourceId` é o `fontes.id` encontrado por (`plataforma='telegram'`, `identificador_externo = grupoExternoId`). `externalId` = `mensagemExternaId`, `text` = `texto`, `publishedAt` = `publicadaEm`. O link e o preço anunciado são extraídos pelo pipeline.

**Ids das fontes:** use sempre o **id marcado** do chat como string, por exemplo `-1001234567890` para canal ou supergrupo. A Bot API e o GramJS usam o mesmo formato. O leitor MTProto **recusa username** e allowlist vazia: no GramJS, um filtro vazio significa todos os chats.

## Regras garantidas em código
- **Só leitura.** O cliente da Bot API aceita apenas `getMe` e `getUpdates`; qualquer outro método é recusado. O `MtClient` expõe só conectar, assinar mensagens novas e o estado da conexão: não há envio nem leitura de histórico.
- **Sem varrer histórico.** A conta MTProto só recebe eventos de mensagem nova. A Bot API entrega o que ficou pendente enquanto o sistema esteve fora (até 24 h, regra do Telegram), e o G0 descarta mensagens com mais de 30 min.
- **Allowlist dupla.** A assinatura é feita só nos canais autorizados, e cada mensagem é conferida de novo contra a allowlist atual, porque a fonte pode ter sido desativada no banco.
- **O token nunca vaza.** Os erros de rede são trocados por `BotApiError('rede:…')`, sem a URL, que contém o token.
- **Segredos:** `TG_BOT_TOKEN`, `TG_API_ID` e `TG_API_HASH` ficam no `.env`. A sessão MTProto fica em disco cifrada (AES-256-GCM, com gravação atômica e permissão 0600), com a chave `TG_SESSION_KEY`. Perder a chave obriga a entrar de novo.

## Conexão e exceções (`excecoes.tipo`)
| Situação | Exceção | Reconecta? |
|---|---|---|
| Rede caiu ou 5xx | `telegram_desconectado` (vermelho), **só depois de 10 min fora**; resolvida ao voltar | sim, com backoff de 1 s a 5 min e jitter; o GramJS também reconecta sozinho |
| 429 da Bot API | — | espera o `retry_after` |
| Bot: token revogado (401/404) ou outra instância/webhook lendo o mesmo bot (409) | `telegram_sessao_invalidada` | **não** |
| Conta: `AUTH_KEY_UNREGISTERED`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `USER_DEACTIVATED` | `telegram_sessao_invalidada`: entrar de novo | **não** |
| Conta: `USER_DEACTIVATED_BAN`, `PHONE_NUMBER_BANNED` | `telegram_numero_bloqueado`: trocar o número | **não** |
| Bot removido de uma fonte (`my_chat_member` left/kicked) | `telegram_removido_do_grupo` (amarelo); resolvida se o bot voltar | — |

## Testes
`npm test`: 17 testes. Bot API com `fetch` mockado: leitura de post e legenda só das fontes permitidas, sem remetente, offset, só `getUpdates`, 401/409, 429, backoff, aviso após o limite, remoção e volta do bot, token sem vazar e formato do token. MTProto com cliente mockado: assinatura só da allowlist, allowlist que muda, allowlist vazia e username recusados, erros de sessão e de ban, retry transitório e aviso de queda. Sessão cifrada: ida e volta, chave errada e arquivo ausente. PGlite com as migrações reais: exceções `telegram_*` sem duplicar.

## Só a PoC-TG real vai validar
- **Primeiro login da conta MTProto** (telefone + código + 2FA). Fica fora deste pacote: será um script da PoC que grava a sessão com `saveSession`.
- Formato real do `chatId` dos eventos do GramJS para os canais escolhidos (id marcado `-100…`).
- Se o GramJS emite `UpdateConnectionState` como esperado nas quedas e se o `autoReconnect` segura uma semana.
- Se o bot recebe `channel_post` nos canais onde foi adicionado e as mensagens de grupo com o modo de privacidade.
- Comportamento de flood wait e risco de ban da conta de leitura com o volume real.
- O que acontece com mensagens editadas, que hoje são ignoradas: edição de preço depois da postagem.
