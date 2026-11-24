// Conector WhatsApp de número único: lê os grupos-fonte e publica SÓ no grupo do cliente.
// Regras duras, em código:
// - destino fora da allowlist nunca chega ao socket (e a allowlist não pode conter fonte);
// - "nao_transmitido" só quando nada foi entregue ao socket; depois disso, falha = "incerto";
// - pausa geral é checada antes e depois do "digitando".

import { createHash } from 'node:crypto';
import type {
  AuthBundle,
  EchoMessage,
  ExceptionSink,
  OutgoingMessage,
  SendOutcome,
  SocketFactory,
  SourceMessage,
  StatusEvent,
  WaSocket,
  WaStatus,
  WhatsAppConnector,
} from './types.ts';

/** Códigos de desconexão do Baileys (DisconnectReason). */
const CODE = {
  loggedOut: 401,
  forbidden: 403,
  multideviceMismatch: 411,
  connectionReplaced: 440,
  badSession: 500,
  restartRequired: 515,
};
/**
 * Sessão morta: reconectar não resolve e pode brigar com outro aparelho.
 * 403 só vem do servidor (stream:error), nunca de logout local: tratado como provável ban.
 * Limitação: um ban também pode chegar como 401 e aí aparece como sessao_invalidada.
 */
const FATAL = new Map<number, { tipo: 'sessao_invalidada' | 'numero_bloqueado'; descricao: string }>([
  [
    CODE.loggedOut,
    {
      tipo: 'sessao_invalidada',
      descricao: 'WhatsApp desconectado: precisa conectar de novo (sessão encerrada no celular).',
    },
  ],
  [
    CODE.multideviceMismatch,
    { tipo: 'sessao_invalidada', descricao: 'WhatsApp desconectado: precisa conectar de novo (sessão incompatível).' },
  ],
  [
    CODE.connectionReplaced,
    {
      tipo: 'sessao_invalidada',
      descricao: 'WhatsApp desconectado: precisa conectar de novo (outro WhatsApp Web assumiu o número).',
    },
  ],
  [
    CODE.badSession,
    { tipo: 'sessao_invalidada', descricao: 'WhatsApp desconectado: precisa conectar de novo (sessão corrompida).' },
  ],
  [
    CODE.forbidden,
    {
      tipo: 'numero_bloqueado',
      descricao: 'O WhatsApp recusou o número (provável bloqueio). Confira no celular; se bloqueado, troque o chip.',
    },
  ],
]);
/** Queda transitória só vira aviso ao cliente se durar mais que isto. */
export const DISCONNECT_ALERT_MS = 10 * 60_000;

export type ConnectorOptions = {
  auth: () => Promise<AuthBundle>;
  socketFactory: SocketFactory;
  /** Grupo(s) do cliente. Único lugar para onde o conector envia. */
  destinos: string[];
  /** Grupos-fonte conhecidos. Nunca recebem mensagem; somem → removido_do_grupo. */
  fontes: string[] | (() => Promise<string[]> | string[]);
  exceptions: ExceptionSink;
  isPaused: () => Promise<boolean> | boolean;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Tempo de "digitando" antes de enviar. */
  typingMs?: [number, number];
  onError?: (e: unknown) => void;
  /** Só para testes. Padrão: DISCONNECT_ALERT_MS (10 min). */
  disconnectAlertMs?: number;
};

export const jidUser = (jid: string) => jid.replace(/:\d+(?=@)/, '');
export const textHash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Backoff exponencial com jitter: 1 s, 2 s, 4 s … até 5 min. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(5 * 60_000, 1000 * 2 ** Math.min(attempt, 20));
  return Math.round(base * (0.5 + random() / 2));
}

// Formas mínimas dos eventos do Baileys que o conector lê.
type ConnectionUpdate = {
  qr?: string;
  connection?: 'open' | 'close' | 'connecting';
  lastDisconnect?: { error?: { output?: { statusCode?: number } } };
};
type WaMessage = {
  key?: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null };
  messageTimestamp?: unknown;
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    imageMessage?: { caption?: string | null } | null;
    videoMessage?: { caption?: string | null } | null;
  } | null;
};
type MessagesUpsert = { type?: string; messages?: WaMessage[] };
type ParticipantsUpdate = { id: string; action: string; participants?: unknown[] };

function textOf(w: WaMessage): string {
  const m = w.message;
  return m?.conversation ?? m?.extendedTextMessage?.text ?? m?.imageMessage?.caption ?? m?.videoMessage?.caption ?? '';
}

const abortError = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new Error('operacao_cancelada');

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(abortError(signal))), { once: true });
  });

export function createWhatsAppConnector(o: ConnectorOptions): WhatsAppConnector {
  const now = o.now ?? Date.now;
  const random = o.random ?? Math.random;
  const sleep = o.sleep ?? defaultSleep;
  const [typeMin, typeMax] = o.typingMs ?? [2000, 5000];
  const onError = o.onError ?? (() => {});
  const destinos = new Set(o.destinos.map(jidUser));
  if (!destinos.size || [...destinos].some((d) => !d.endsWith('@g.us')))
    throw new Error('destino deve ser um grupo (@g.us)');

  let sock: WaSocket | null = null;
  let auth: AuthBundle | null = null;
  let state: WaStatus = 'parado';
  const statusHandlers = new Set<(s: StatusEvent) => void>();
  /** Muda o estado e avisa os ouvintes. Cada QR novo é avisado mesmo sem mudar de estado. */
  const setState = (next: WaStatus, qr?: string) => {
    if (next === state && !qr) return;
    state = next;
    const ev: StatusEvent = qr ? { estado: next, qr } : { estado: next };
    notify(ev);
  };
  /** Ouvinte com erro não pode interromper o fluxo de conexão (QR, alertas, reconexão). */
  function notify(ev: StatusEvent, only?: (s: StatusEvent) => void) {
    for (const h of only ? [only] : statusHandlers) {
      try {
        h(ev);
      } catch (e) {
        onError(e);
      }
    }
  }
  let open = false;
  let attempt = 0;
  let stopped = false;
  let generation = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let alertTimer: ReturnType<typeof setTimeout> | null = null;
  const alertAfterMs = o.disconnectAlertMs ?? DISCONNECT_ALERT_MS;
  const clearAlert = () => {
    if (alertTimer) clearTimeout(alertTimer);
    alertTimer = null;
  };
  const msgHandlers = new Set<(m: SourceMessage) => void>();
  const echoHandlers = new Set<(e: EchoMessage) => void>();
  const qrWaiters: ((qr: string) => void)[] = [];
  const inflight = new Map<string, Promise<SendOutcome>>();

  /** Dispara sem esperar; erro vai para onError (efeitos colaterais de evento). */
  const safe = (p: Promise<unknown>): void => void p.catch(onError);

  async function sources(): Promise<Set<string>> {
    return new Set((await (typeof o.fontes === 'function' ? o.fontes() : o.fontes)).map(jidUser));
  }

  async function assertAllowlist() {
    const f = await sources();
    for (const d of destinos) if (f.has(d)) throw new Error(`destino ${d} também é fonte: bloqueado`);
  }

  async function checkGroupsAfterOpen(s: WaSocket) {
    const groups = await s.groupFetchAllParticipating();
    const present = new Set(Object.keys(groups).map(jidUser));
    for (const g of await sources()) {
      if (present.has(g)) await o.exceptions.resolve('removido_do_grupo', g);
      else
        await o.exceptions.open({
          tipo: 'removido_do_grupo',
          descricao: 'O número não está mais neste grupo-fonte.',
          severidade: 'amarelo',
          grupoExternoId: g,
        });
    }
    for (const d of destinos) {
      if (present.has(d)) await o.exceptions.resolve('removido_do_grupo', d);
      else
        await o.exceptions.open({
          tipo: 'removido_do_grupo',
          descricao: 'O número não está no grupo do cliente: envios parados.',
          severidade: 'vermelho',
          grupoExternoId: d,
        });
    }
  }

  function isMe(s: WaSocket, participant: unknown): boolean {
    const p =
      typeof participant === 'string'
        ? { id: participant }
        : ((participant ?? {}) as { id?: string; lid?: string; phoneNumber?: string });
    const mine = [s.user?.id, s.user?.lid].filter(Boolean).map((j) => jidUser(j!));
    return [p.id, p.lid, p.phoneNumber].filter(Boolean).some((j) => mine.includes(jidUser(j!)));
  }

  function scheduleReconnect(immediate: boolean) {
    if (stopped) return;
    const delay = immediate ? 0 : backoffMs(attempt++, random);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void start().catch(onError);
    }, delay);
  }

  function wire(s: WaSocket, gen: number) {
    const current = () => gen === generation && !stopped;
    s.ev.on('creds.update', () => {
      if (current() && auth) safe(auth.saveCreds());
    });

    s.ev.on('connection.update', (u: ConnectionUpdate) => {
      if (!current()) return;
      if (u.qr) {
        setState('aguardando_pareamento', u.qr);
        for (const w of qrWaiters.splice(0)) w(u.qr);
      }
      if (u.connection === 'open') {
        open = true;
        attempt = 0;
        setState('conectado');
        clearAlert();
        safe(o.exceptions.resolve('desconectado'));
        safe(o.exceptions.resolve('sessao_invalidada'));
        safe(o.exceptions.resolve('numero_bloqueado'));
        safe(checkGroupsAfterOpen(s));
      }
      if (u.connection === 'close') {
        open = false;
        const code = u.lastDisconnect?.error?.output?.statusCode;
        const fatal = code !== undefined ? FATAL.get(code) : undefined;
        if (fatal) {
          setState(fatal.tipo === 'numero_bloqueado' ? 'numero_bloqueado' : 'sessao_invalida');
          clearAlert();
          safe(o.exceptions.resolve('desconectado'));
          safe(o.exceptions.open({ tipo: fatal.tipo, descricao: fatal.descricao, severidade: 'vermelho' }));
          return;
        }
        if (code === CODE.restartRequired) {
          setState('conectando');
          scheduleReconnect(true);
          return;
        }
        setState('reconectando');
        // Aviso só se a queda durar mais de 10 min; até lá, só reconecta.
        alertTimer ??= setTimeout(() => {
          alertTimer = null;
          if (!open && !stopped && state === 'reconectando')
            safe(
              o.exceptions.open({
                tipo: 'desconectado',
                descricao: 'WhatsApp fora do ar há mais de 10 min; o sistema segue tentando reconectar.',
                severidade: 'vermelho',
              }),
            );
        }, alertAfterMs);
        scheduleReconnect(false);
      }
    });

    s.ev.on('messages.upsert', (u: MessagesUpsert) => {
      if (!current()) return;
      for (const m of u.messages ?? []) {
        const jid = jidUser(m.key?.remoteJid ?? '');
        const id = m.key?.id;
        if (!jid.endsWith('@g.us') || !id) continue;
        const texto = textOf(m);
        // messageTimestamp vem como number ou Long (protobuf); Number() cobre os dois.
        const em = Number(m.messageTimestamp ?? 0) * 1000 || now();
        if (m.key?.fromMe) {
          if (destinos.has(jid)) {
            const e = { grupoExternoId: jid, mensagemExternaId: id, textoHash: textHash(texto), em };
            for (const h of echoHandlers) h(e);
          }
          continue;
        }
        // Só mensagem nova (não histórico) de grupo que não é o do cliente. Sem remetente.
        if (u.type !== 'notify' || destinos.has(jid) || !texto) continue;
        const sm: SourceMessage = {
          plataforma: 'whatsapp',
          grupoExternoId: jid,
          mensagemExternaId: id,
          texto,
          publicadaEm: em,
        };
        for (const h of msgHandlers) h(sm);
      }
    });

    s.ev.on('group-participants.update', (u: ParticipantsUpdate) => {
      if (!current() || u.action !== 'remove' || !(u.participants ?? []).some((p: unknown) => isMe(s, p))) return;
      const g = jidUser(u.id);
      const cliente = destinos.has(g);
      safe(
        o.exceptions.open({
          tipo: 'removido_do_grupo',
          descricao: cliente
            ? 'O número foi removido do grupo do cliente: envios parados.'
            : 'O número foi removido de um grupo-fonte.',
          severidade: cliente ? 'vermelho' : 'amarelo',
          grupoExternoId: g,
        }),
      );
    });
  }

  async function start() {
    if (stopped) return;
    await assertAllowlist();
    auth ??= await o.auth();
    const gen = ++generation;
    open = false;
    setState(attempt === 0 && state !== 'reconectando' ? 'conectando' : 'reconectando');
    sock = await o.socketFactory(auth);
    wire(sock, gen);
  }

  const socketOpen = () => open && !!sock && sock.ws?.isOpen !== false;

  function nextQr(timeoutMs = 60_000): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('qr_timeout')), timeoutMs);
      qrWaiters.push((qr) => (clearTimeout(t), resolve(qr)));
    });
  }

  async function doSend(groupId: string, msg: OutgoingMessage, signal?: AbortSignal): Promise<SendOutcome> {
    const jid = jidUser(groupId);
    if (!destinos.has(jid) || (await sources()).has(jid))
      return { status: 'nao_transmitido', motivo: 'destino_nao_permitido' };
    if (await o.isPaused()) return { status: 'nao_transmitido', motivo: 'pausado' };
    if (!socketOpen()) return { status: 'nao_transmitido', motivo: 'socket_fechado' };
    const s = sock!;
    try {
      await s.sendPresenceUpdate('composing', jid);
      await sleep(typeMin + random() * (typeMax - typeMin), signal);
    } catch {
      // Presença e espera não transmitem a oferta: ainda é seguro dizer que não saiu.
      return { status: 'nao_transmitido', motivo: signal?.aborted ? 'cancelado_antes_de_enviar' : 'socket_fechado' };
    }
    if (await o.isPaused()) return { status: 'nao_transmitido', motivo: 'pausado' };
    if (!socketOpen() || s !== sock) return { status: 'nao_transmitido', motivo: 'socket_fechado' };

    // A partir daqui a mensagem foi entregue ao socket: qualquer falha é "incerto".
    const content = msg.mediaUrl ? { image: { url: msg.mediaUrl }, caption: msg.texto } : { text: msg.texto };
    let outcome: SendOutcome;
    try {
      const sent = s.sendMessage(jid, content);
      const res = signal
        ? await Promise.race([
            sent,
            new Promise<never>((_, reject) => {
              if (signal.aborted) reject(abortError(signal));
              signal.addEventListener('abort', () => reject(abortError(signal)), { once: true });
            }),
          ])
        : await sent;
      const id = res?.key?.id;
      outcome = id ? { status: 'enviado', mensagemId: id } : { status: 'incerto', motivo: 'ack_sem_id' };
    } catch (e) {
      outcome = {
        status: 'incerto',
        motivo: signal?.aborted
          ? 'timeout_durante_envio'
          : `erro_durante_envio:${(e as Error)?.message ?? 'desconhecido'}`,
      };
    }
    safe(s.sendPresenceUpdate('paused', jid));
    return outcome;
  }

  return {
    async connect() {
      stopped = false;
      await start();
    },
    async pairByCode(phone) {
      const digits = phone.replace(/\D/g, '');
      if (!/^\d{10,15}$/.test(digits)) throw new Error('telefone_invalido');
      if (auth?.state.creds.registered) throw new Error('ja_pareado');
      if (state === 'parado') await start();
      // O Baileys só aceita pedir o código depois que o socket está pronto (1º evento de QR).
      if (state !== 'aguardando_pareamento') await nextQr();
      return sock!.requestPairingCode(digits);
    },
    async pairByQR() {
      if (auth?.state.creds.registered) throw new Error('ja_pareado');
      if (state === 'parado') await start();
      return nextQr();
    },
    onMessage(h) {
      msgHandlers.add(h);
      return () => msgHandlers.delete(h);
    },
    onStatus(h) {
      statusHandlers.add(h);
      // Estado atual na inscrição: um cliente SSE novo não precisa esperar a próxima mudança.
      queueMicrotask(() => {
        if (statusHandlers.has(h)) notify({ estado: state }, h);
      });
      return () => statusHandlers.delete(h);
    },
    onEcho(h) {
      echoHandlers.add(h);
      return () => echoHandlers.delete(h);
    },
    async listGroups() {
      if (!socketOpen()) throw new Error('socket_fechado');
      const groups = await sock!.groupFetchAllParticipating();
      return Object.values(groups).map((g) => ({
        id: g.id,
        nome: g.subject ?? '',
        participantes: g.participants?.length ?? 0,
      }));
    },
    sendToGroup(groupId, msg, idempotencyKey, signal) {
      // Mesma chave no mesmo processo: devolve o mesmo resultado, nunca envia duas vezes.
      // Entre processos/reinícios, quem garante é a tabela envios (estado incerto antes do envio).
      const existing = inflight.get(idempotencyKey);
      if (existing) return existing;
      const p = doSend(groupId, msg, signal);
      inflight.set(idempotencyKey, p);
      void p.then((r) => {
        if (r.status === 'nao_transmitido') inflight.delete(idempotencyKey);
        else if (inflight.size > 1000) inflight.delete(inflight.keys().next().value!);
      });
      return p;
    },
    status: () => state,
    async stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearAlert();
      open = false;
      setState('parado');
      sock?.end();
      sock = null;
    },
  };
}
