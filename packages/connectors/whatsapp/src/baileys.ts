// Fábrica do socket real. Só é chamada na PoC-WA aprovada; os testes usam um socket mockado.
import makeWASocket, { Browsers } from 'baileys';
import type { SocketFactory, WaSocket } from './types.ts';

export function baileysSocketFactory(opts: { logger?: any } = {}): SocketFactory {
  return ({ state }) =>
    makeWASocket({
      auth: state as any,
      browser: Browsers.windows('Chrome'),
      // Não aparece "online" ao conectar e não baixa o histórico: menos tráfego e menos sinal de automação.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      ...(opts.logger ? { logger: opts.logger } : {}),
    }) as unknown as WaSocket;
}
