import type { PipelineOutcome, QueuedOffer } from './pipeline-types.js';
import { g9 } from './gates.js';

export interface QueueItem extends QueuedOffer {
  id: string;
  destinoId: string;
  idempotencyKey: string;
}
export interface DispatchState {
  pausado: boolean;
  limiteHora: number;
  limiteDia: number;
  horarioInicio: string;
  horarioFim: string;
  fuso: string;
  contagemHora: number;
  contagemDia: number;
  proximoEm: number;
}
export interface QueueStore {
  lock<T>(work: () => Promise<T>): Promise<T | null>;
  expire(now: number): Promise<void>;
  state(now: number): Promise<DispatchState>;
  next(now: number): Promise<QueueItem | null>;
  discard(id: string, reason: string): Promise<void>;
  defer(id: string, when: number): Promise<void>;
  claim(item: QueueItem, result: PipelineOutcome, now: number, next: number): Promise<boolean>;
  confirmed(id: string, externalId: string, now: number, simulated?: boolean): Promise<void>;
  uncertain(id: string, reason: string): Promise<void>;
  notTransmitted(id: string, reason: string): Promise<void>;
}
export type PublishResult =
  | { status: 'enviado'; mensagemId: string; simulado?: boolean }
  | { status: 'incerto'; motivo: string }
  | { status: 'falhou'; naoTransmitido: true; motivo: string };
export interface Publisher {
  send(
    message: { destinoId: string; texto: string; mediaUrl: string | null; idempotencyKey: string },
    signal: AbortSignal,
  ): Promise<PublishResult>;
}
export interface QueueDependencies {
  store: QueueStore;
  publisher: Publisher;
  now(): number;
  random(): number;
  validate(item: QueueItem): Promise<PipelineOutcome>;
}
export function sendingWindow(now: number, start: string, end: string, zone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const current = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
  return current >= start.slice(0, 5) && current < end.slice(0, 5);
}
function blocked(s: DispatchState, now: number): string | null {
  if (s.pausado) return 'pausado';
  if (
    ![s.limiteHora, s.limiteDia, s.contagemHora, s.contagemDia, s.proximoEm].every(Number.isFinite) ||
    s.limiteHora < 1 ||
    s.limiteDia < 1
  )
    throw new Error('estado de fila invalido');
  if (!sendingWindow(now, s.horarioInicio, s.horarioFim, s.fuso)) return 'fora_do_horario';
  if (s.contagemHora >= s.limiteHora || s.contagemDia >= s.limiteDia) return 'limite';
  return now < s.proximoEm ? 'intervalo' : null;
}
export async function dispatchNext(d: QueueDependencies): Promise<string> {
  const result = await d.store.lock(async () => {
    await d.store.expire(d.now());
    let reason = blocked(await d.store.state(d.now()), d.now());
    if (reason) return reason;
    const item = await d.store.next(d.now());
    if (!item) return 'vazia';
    const checked = await d.validate(item);
    if (checked.resultado.status === 'ADIA') {
      await d.store.defer(item.id, checked.resultado.quando);
      return 'adiado';
    }
    if (checked.resultado.status !== 'PASSA') {
      await d.store.discard(item.id, checked.resultado.motivo);
      return 'descartado';
    }
    if (!checked.mensagem || !checked.produto) {
      await d.store.discard(item.id, 'mensagem inválida');
      return 'descartado';
    }
    const now = d.now();
    if (g9(item.input.recebidaEm, item.enfileiradaEm, now, item.config.ttlMs).status !== 'PASSA') {
      await d.store.discard(item.id, 'vencida na fila');
      return 'descartado';
    }
    reason = blocked(await d.store.state(now), now);
    if (reason) return reason;
    const random = d.random();
    if (!Number.isFinite(random) || random < 0 || random > 1) throw new Error('sorteio invalido');
    const next = now + 3 * 60000 + Math.floor(random * 5 * 60000);
    // Write-ahead: crash/timeout depois deste ponto nunca devolve a oferta para a fila.
    if (!(await d.store.claim(item, checked, now, next))) return 'nao_reservado';
    const signal = AbortSignal.timeout(30000);
    let published: PublishResult;
    try {
      published = await Promise.race([
        d.publisher.send(
          {
            destinoId: item.destinoId,
            texto: checked.mensagem.texto,
            mediaUrl: checked.mensagem.mediaUrl,
            idempotencyKey: item.idempotencyKey,
          },
          signal,
        ),
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('timeout de envio')), { once: true });
        }),
      ]);
    } catch {
      await d.store.uncertain(item.id, 'falha ou timeout sem confirmacao');
      return 'incerto';
    }
    if (published.status === 'enviado' && typeof published.mensagemId === 'string' && published.mensagemId.trim()) {
      await d.store.confirmed(item.id, published.mensagemId, d.now(), published.simulado);
      return published.simulado ? 'simulado' : 'enviado';
    }
    if (published.status === 'falhou' && published.naoTransmitido === true) {
      await d.store.notTransmitted(item.id, published.motivo);
      return 'falhou';
    }
    await d.store.uncertain(item.id, 'motivo' in published ? published.motivo : 'ack invalido');
    return 'incerto';
  });
  return result ?? 'ocupado';
}
