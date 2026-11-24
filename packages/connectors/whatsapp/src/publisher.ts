// Adapter para o Publisher do Pleno (packages/core/src/send-queue.ts). Tipos repetidos aqui
// de forma estrutural para o conector não depender do core.
import type { WhatsAppConnector } from './types.ts';

export type PublishResult =
  | { status: 'enviado'; mensagemId: string }
  | { status: 'incerto'; motivo: string }
  | { status: 'falhou'; naoTransmitido: true; motivo: string };

export interface Publisher {
  send(message: { destinoId: string; texto: string; mediaUrl: string | null; idempotencyKey: string }, signal: AbortSignal): Promise<PublishResult>;
}

export function createWhatsAppPublisher(connector: Pick<WhatsAppConnector, 'sendToGroup'>): Publisher {
  return {
    async send(m, signal) {
      try {
        const r = await connector.sendToGroup(m.destinoId, { texto: m.texto, mediaUrl: m.mediaUrl }, m.idempotencyKey, signal);
        if (r.status === 'enviado') return r;
        if (r.status === 'nao_transmitido') return { status: 'falhou', naoTransmitido: true, motivo: r.motivo };
        return r;
      } catch (e) {
        // Erro inesperado do adapter: não dá para provar que não saiu.
        return { status: 'incerto', motivo: `erro_adapter:${(e as Error)?.message ?? 'desconhecido'}` };
      }
    },
  };
}
