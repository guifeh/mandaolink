// Adapter real do MTProto (GramJS). Só é usado na PoC-TG aprovada; os testes usam um MtClient mockado.
// Expõe apenas conectar, assinar mensagens novas e estado da conexão: sem envio e sem histórico.
import { TelegramClient } from 'telegram';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import { UpdateConnectionState } from 'telegram/network/index.js';
import { StringSession } from 'telegram/sessions/index.js';
import type { MtClient, MtConnection } from './mtproto.ts';

export type GramjsOptions = {
  /** TG_API_ID e TG_API_HASH do .env (my.telegram.org). */
  apiId: number;
  apiHash: string;
  /** Sessão já autenticada (StringSession), lida cifrada de disco por session-store.ts. */
  session: string;
};

export function createGramjsClient(o: GramjsOptions): MtClient {
  if (!Number.isSafeInteger(o.apiId) || o.apiId <= 0 || !/^[a-f0-9]{32}$/i.test(o.apiHash)) {
    throw new Error('TG_API_ID/TG_API_HASH inválidos');
  }
  if (!o.session) throw new Error('sessão MTProto ausente: faça o login na PoC-TG');
  const client = new TelegramClient(new StringSession(o.session), o.apiId, o.apiHash, {
    connectionRetries: 5,
    autoReconnect: true,
  });
  client.setLogLevel('error' as Parameters<typeof client.setLogLevel>[0]);

  return {
    connect: () => client.connect().then(() => undefined),
    disconnect: () => client.disconnect(),
    onNewMessage(chats, handler) {
      client.addEventHandler(
        (ev: NewMessageEvent) => {
          const m = ev.message;
          handler({ chatId: String(m.chatId), id: m.id, text: m.message ?? '', date: m.date });
        },
        new NewMessage({ chats: chats.map(Number), incoming: true }),
      );
    },
    onConnectionChange(handler) {
      client.addEventHandler((update: unknown) => {
        if (!(update instanceof UpdateConnectionState)) return;
        const map: Record<number, MtConnection> = {
          [UpdateConnectionState.connected]: 'connected',
          [UpdateConnectionState.disconnected]: 'disconnected',
          [UpdateConnectionState.broken]: 'broken',
        };
        const s = map[update.state];
        if (s) handler(s);
      });
    },
  };
}
