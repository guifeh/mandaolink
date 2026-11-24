// Leitor via Bot API (fontes que adicionaram o nosso bot). Long polling em getUpdates.
// Só leitura, garantido em código: o cliente HTTP aceita apenas getMe e getUpdates.
// O token nunca aparece em erro, log ou exceção.
import { backoffMs, createLifecycle, DISCONNECT_ALERT_MS, readAllowlist } from './shared.ts';
import type { Allowlist, ExceptionSink, TelegramSource } from './types.ts';

const READ_ONLY_METHODS = new Set(['getMe', 'getUpdates']);
const POLL_TIMEOUT_S = 25;

type TgMessage = {
  message_id: number;
  date: number;
  chat: { id: number | string };
  text?: string;
  caption?: string;
};
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  my_chat_member?: { chat: { id: number | string }; new_chat_member: { status: string } };
};
type TgResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export class BotApiError extends Error {
  readonly code: number;
  readonly retryAfterS?: number;
  constructor(code: number, message: string, retryAfterS?: number) {
    super(message);
    this.code = code;
    this.retryAfterS = retryAfterS;
  }
}

export type BotSourceOptions = {
  token: string;
  /** Ids de chat (Bot API) das fontes autorizadas, ex.: "-1001234567890". */
  fontes: Allowlist;
  exceptions: ExceptionSink;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  onError?: (e: unknown) => void;
  disconnectAlertMs?: number;
};

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

export function createBotSource(o: BotSourceOptions): TelegramSource {
  if (!/^\d+:[\w-]{20,}$/.test(o.token)) throw new Error('TG_BOT_TOKEN com formato inválido');
  const doFetch = o.fetchImpl ?? fetch;
  const sleep = o.sleep ?? defaultSleep;
  const random = o.random ?? Math.random;
  const onError = o.onError ?? (() => {});
  const life = createLifecycle({
    exceptions: o.exceptions,
    onError,
    alertAfterMs: o.disconnectAlertMs ?? DISCONNECT_ALERT_MS,
    fonte: 'bot',
  });
  let abort: AbortController | null = null;
  let loop: Promise<void> | null = null;
  let offset = 0;

  async function call<T>(method: string, params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    if (!READ_ONLY_METHODS.has(method)) throw new Error(`método ${method} bloqueado: conector só lê`);
    let res: Response;
    try {
      res = await doFetch(`https://api.telegram.org/bot${o.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.any([signal, AbortSignal.timeout((POLL_TIMEOUT_S + 10) * 1000)]),
      });
    } catch (e) {
      // Erro de rede: nunca propaga o erro original, que pode carregar a URL com o token.
      throw new BotApiError(0, `rede:${(e as Error)?.name ?? 'erro'}`);
    }
    const body = (await res.json().catch(() => ({ ok: false }))) as TgResponse<T>;
    if (body.ok) return body.result as T;
    throw new BotApiError(
      body.error_code ?? res.status,
      body.description ?? `http_${res.status}`,
      body.parameters?.retry_after,
    );
  }

  async function handle(updates: TgUpdate[]) {
    const allow = await readAllowlist(o.fontes);
    for (const u of updates) {
      offset = Math.max(offset, u.update_id + 1);
      const m = u.message ?? u.channel_post;
      if (m) {
        const chat = String(m.chat.id);
        const texto = m.text ?? m.caption ?? '';
        if (!allow.has(chat) || !texto) continue;
        life.emit({
          plataforma: 'telegram',
          grupoExternoId: chat,
          mensagemExternaId: String(m.message_id),
          texto,
          publicadaEm: m.date * 1000,
        });
      }
      const member = u.my_chat_member;
      if (member && allow.has(String(member.chat.id))) {
        const s = member.new_chat_member.status;
        if (s === 'left' || s === 'kicked') life.removed(String(member.chat.id));
        else void o.exceptions.resolve('removido_do_grupo', String(member.chat.id)).catch(onError);
      }
    }
  }

  async function run(signal: AbortSignal) {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const updates = await call<TgUpdate[]>(
          'getUpdates',
          { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'channel_post', 'my_chat_member'] },
          signal,
        );
        if (life.status() !== 'conectado') life.connected();
        attempt = 0;
        await handle(updates);
      } catch (e) {
        if (signal.aborted) return;
        const err = e instanceof BotApiError ? e : new BotApiError(0, 'erro_desconhecido');
        if (err.code === 401 || err.code === 404) {
          life.fatal('sessao_invalidada', 'Token do bot do Telegram inválido ou revogado: gere outro no BotFather.');
          return;
        }
        if (err.code === 409) {
          life.fatal(
            'sessao_invalidada',
            'Outra instância (ou um webhook) está lendo este bot. Pare a outra antes de reconectar.',
          );
          return;
        }
        if (err.code === 429) {
          await sleep((err.retryAfterS ?? 5) * 1000, signal);
          continue;
        }
        onError(err);
        life.dropped();
        await sleep(backoffMs(attempt++, random), signal);
      }
    }
  }

  return {
    async start() {
      if (loop) return;
      abort = new AbortController();
      life.set('conectando');
      loop = run(abort.signal);
    },
    async stop() {
      abort?.abort();
      await loop;
      loop = null;
      life.stopped();
    },
    onMessage: (h) => life.onMessage(h),
    status: () => life.status(),
  };
}
