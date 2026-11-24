// Fábrica do socket real. Só é chamada na PoC-WA aprovada; os testes usam um socket mockado.
import makeWASocket, { Browsers, type AuthenticationState } from 'baileys';
import type { SocketFactory, WaSocket } from './types.ts';

type BaileysLogger = NonNullable<Parameters<typeof makeWASocket>[0]['logger']>;

export function baileysSocketFactory(opts: { logger?: BaileysLogger } = {}): SocketFactory {
  return ({ state }) =>
    // Duas conversões explícitas, de propósito:
    // - o auth state vem de useEncryptedFileAuthState, no formato do Baileys (o tipo local é mais estreito);
    // - o ev.on do Baileys é genérico por evento; o WaSocket só declara a forma que o conector lê
    //   (formas de cada evento tipadas em connector.ts). A PoC-WA valida o contrato real.
    makeWASocket({
      auth: state as unknown as AuthenticationState,
      browser: Browsers.windows('Chrome'),
      // Não aparece "online" ao conectar e não baixa o histórico: menos tráfego e menos sinal de automação.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      ...(opts.logger ? { logger: opts.logger } : {}),
    }) as unknown as WaSocket;
}
