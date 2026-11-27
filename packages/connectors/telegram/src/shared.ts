// Peças comuns aos dois leitores: allowlist, backoff, aviso de queda depois de 10 min e ouvintes isolados.
import type { Allowlist, ExceptionSink, SourceMessage, TgStatus } from './types.ts';

export const DISCONNECT_ALERT_MS = 10 * 60_000;

export async function readAllowlist(a: Allowlist): Promise<Set<string>> {
  return new Set((await (typeof a === 'function' ? a() : a)).map(String));
}

/** Backoff exponencial com jitter: 1 s, 2 s, 4 s … até 5 min. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(5 * 60_000, 1000 * 2 ** Math.min(attempt, 20));
  return Math.round(base * (0.5 + random() / 2));
}

export function createLifecycle(o: {
  exceptions: ExceptionSink;
  onError: (e: unknown) => void;
  alertAfterMs: number;
  fonte: 'bot' | 'conta';
}) {
  let state: TgStatus = 'parado';
  let alertTimer: ReturnType<typeof setTimeout> | null = null;
  const handlers = new Set<(m: SourceMessage) => void>();
  const safe = (p: Promise<unknown>): void => void p.catch(o.onError);
  const clearAlert = () => {
    if (alertTimer) clearTimeout(alertTimer);
    alertTimer = null;
  };
  const quem = o.fonte === 'bot' ? 'O bot do Telegram' : 'A conta de leitura do Telegram';
  return {
    status: () => state,
    set(s: TgStatus) {
      state = s;
    },
    connected() {
      state = 'conectado';
      clearAlert();
      safe(o.exceptions.resolve('desconectado'));
    },
    /** Queda transitória: só vira aviso se durar mais que alertAfterMs. */
    dropped() {
      state = 'reconectando';
      alertTimer ??= setTimeout(() => {
        alertTimer = null;
        if (state === 'reconectando')
          safe(
            o.exceptions.open({
              tipo: 'desconectado',
              descricao: `${quem} está fora do ar há mais de 10 min; o sistema segue tentando reconectar.`,
              severidade: 'vermelho',
            }),
          );
      }, o.alertAfterMs);
    },
    fatal(tipo: 'sessao_invalidada' | 'numero_bloqueado', descricao: string) {
      state = tipo === 'numero_bloqueado' ? 'numero_bloqueado' : 'sessao_invalida';
      clearAlert();
      safe(o.exceptions.resolve('desconectado'));
      safe(o.exceptions.open({ tipo, descricao, severidade: 'vermelho' }));
    },
    removed(grupoExternoId: string) {
      safe(
        o.exceptions.open({
          tipo: 'removido_do_grupo',
          descricao: `${quem} não está mais nesta fonte.`,
          severidade: 'amarelo',
          grupoExternoId,
        }),
      );
    },
    stopped() {
      state = 'parado';
      clearAlert();
    },
    emit(m: SourceMessage) {
      for (const h of handlers) {
        try {
          h(m);
        } catch (e) {
          o.onError(e);
        }
      }
    },
    onMessage(h: (m: SourceMessage) => void) {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  };
}
