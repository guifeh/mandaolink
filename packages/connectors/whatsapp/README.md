# @mandaolink/connector-whatsapp (S2)

Conector de **número único**: lê os grupos-fonte e publica só no grupo do cliente. Usa Baileys **`7.0.0-rc14`, versão exata** (`--save-exact`). Só atualize testando antes no grupo de teste.

> Nada aqui pareia nem conecta número sem a PoC-WA aprovada. Os testes usam um socket mockado.

## Uso

```ts
import {
  createWhatsAppConnector, createWhatsAppPublisher, createPgExceptionSink,
  useEncryptedFileAuthState, parseAuthKey, baileysSocketFactory,
} from '@mandaolink/connector-whatsapp';

const wa = createWhatsAppConnector({
  auth: () => useEncryptedFileAuthState('./data/wa-auth', parseAuthKey(process.env.WA_AUTH_KEY)),
  socketFactory: baileysSocketFactory(),
  destinos: [process.env.WA_GRUPO_CLIENTE!],             // allowlist: só o grupo do cliente
  fontes: async () => idsExternosDasFontesWhatsApp(),     // fontes.identificador_externo
  exceptions: createPgExceptionSink(pool),
  isPaused: async () => (await pool.query('SELECT pausado FROM config_nicho WHERE id=1')).rows[0].pausado,
});
wa.onMessage((m) => { /* SourceMessage → mensagens_brutas */ });
wa.onEcho((e) => { /* reconciliador S4: incerto → enviado */ });
await wa.connect();
const publisher = createWhatsAppPublisher(wa);              // Publisher do send-queue (P2)
```

`.env`: `WA_AUTH_KEY` com 32 bytes em base64, gerado por `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Perder a chave = parear de novo.** Guarde a chave fora do PC, no cofre.

## Regras garantidas em código
- **Nunca escreve em grupo-fonte.** O destino precisa estar na allowlist `destinos`, e nenhum destino pode ser fonte: o conector recusa conectar com essa configuração e recusa cada envio. Mensagem fora da regra não chega ao socket, nem como presença.
- **`falhou + naoTransmitido` só com prova.** Isso vale para destino recusado, pausa, socket fechado antes ou durante o "digitando" e cancelamento antes do envio. Depois que o `sendMessage` é chamado, qualquer erro, timeout ou ack sem id vira **`incerto`**, que nunca é reenviado.
- **Envio "humano".** O conector manda a presença "digitando", espera 2 a 5 s, confere a pausa e o socket de novo e envia com foto e legenda. Depois manda "parou de digitar". O intervalo de 3 a 8 min entre envios é da fila (P2).
- **Idempotência:** a mesma chave no mesmo processo nunca envia duas vezes. Entre reinícios, a garantia é a tabela `envios`.
- **LGPD:** `SourceMessage` não traz remetente, nome nem telefone.

## Conexão e exceções (`excecoes.tipo`)
| Evento | Quando | Exceção | Reconecta? |
|---|---|---|---|
| queda comum (rede, 408, 428, 503…) | `connection: close` | nenhuma nos primeiros 10 min; depois, `whatsapp_desconectado` (vermelho), resolvida ao reabrir | sim, com backoff de 1 s → 5 min e jitter |
| `restartRequired` (515) | normal após parear | — | sim, na hora |
| sessão inválida (401 deslogado, 411, 440 outra sessão assumiu, 500) | `connection: close` | `whatsapp_sessao_invalidada` (vermelho). No painel: "WhatsApp desconectado: precisa conectar de novo", que leva à tela de pareamento | **não** |
| servidor recusou o número (403) | `connection: close` | `whatsapp_numero_bloqueado` (vermelho). No painel: "provável bloqueio: confira no celular e troque o chip" | **não** |
| removido de um grupo | `group-participants.update` com o nosso id ou LID, ou o grupo sumiu da lista ao reconectar | `whatsapp_removido_do_grupo`: amarelo para fonte, vermelho para o grupo do cliente | — |

**Limitação do 403 × ban:** no Baileys, o 403 só vem do servidor (`stream:error`); nenhum logout local gera esse código. Por isso ele é tratado como provável bloqueio. Mas o WhatsApp também pode derrubar um número banido com 401, e aí o aviso será `sessao_invalidada`. Se o reparear falhar, o cliente deve conferir no celular se o número foi banido. A PoC-WA não vai provocar um ban de propósito, então essa distinção só se confirma se um ban acontecer.

## Pareamento (para a API/PWA, P4)
- `pairByCode('+55 11 9…')` devolve um código de 8 caracteres. O cliente digita no celular, em Aparelhos conectados → Conectar com número de telefone. O conector espera o socket ficar pronto antes de pedir o código.
- `pairByQR()` devolve o texto do QR, que o PWA desenha. O QR muda a cada ~20 s; chame de novo para pegar o próximo.
- `status()`: `parado | conectando | aguardando_pareamento | conectado | reconectando | sessao_invalida | numero_bloqueado`.
- `onStatus(h)` → unsubscribe: avisa `{ estado, qr? }` a cada mudança de estado e a cada QR novo. Encaixa no `PairingService.subscribe` da P6 (SSE `/pareamento/eventos`); o `qr` vale ~20 s.

## Reconciliação (S4)
`onEcho` entrega `{ grupoExternoId, mensagemExternaId, textoHash, em }`. O `textoHash` usa o mesmo sha256 do `envios.texto_hash`. O reconciliador promove `incerto → enviado` por `mensagem_externa_id` ou, se não houver, por `texto_hash` + destino nos 10 min seguintes. A corrida eco × ack está fechada: o `queue-store.confirmed` do Pleno aceita o envio já `enviado` sem sobrescrever o id conciliado.

## Testes
`npm test`: 20 testes. Com socket mockado: envio, idempotência, allowlist, queda antes, durante o "digitando" e durante a transmissão, timeout, ack sem id, pausa, eco, mensagem de fonte sem remetente, reconexão, 515, sessão inválida, remoção do grupo ao vivo e ao reconectar, pareamento, backoff e auth cifrado. No PGlite, com as migrações reais: exceções sem duplicar, resolver e reabrir.

## Só a PoC-WA real vai validar
- Se o pareamento por código funciona com o chip e a versão do WhatsApp do celular.
- Estabilidade da sessão por 1 semana: frequência de quedas e de 401/440, e se o backoff segura.
- Se o eco do próprio envio chega sempre e em quanto tempo, e com que `type` (`append` ou `notify`). Também se o id do eco bate com o id do ack.
- Se o evento de remoção chega com o nosso id em formato **LID** ou telefone nos grupos escolhidos.
- O comportamento de imagem por URL (a foto da Amazon): tempo, falhas e tamanho.
- Se a presença "digitando" aparece no grupo e se `markOnlineOnConnect: false` deixa o número "offline".
- Sinais de restrição ou ban com o ritmo real da fila (limites de hora e dia, intervalo de 3 a 8 min).
- Consumo de memória e CPU em 24 h no PC.
