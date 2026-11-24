// Contratos do conector WhatsApp. O socket real (Baileys) e o mock dos testes seguem WaSocket.

/** Parte do socket do Baileys que o conector usa. Mantida mínima para o mock ser fiel. */
export interface WaSocket {
  ev: { on(event: string, handler: (arg: any) => void): void };
  ws?: { isOpen: boolean };
  user?: { id: string; lid?: string } | null;
  sendMessage(jid: string, content: Record<string, unknown>): Promise<{ key?: { id?: string | null } } | undefined>;
  sendPresenceUpdate(type: 'composing' | 'paused' | 'available' | 'unavailable', jid?: string): Promise<void>;
  groupFetchAllParticipating(): Promise<Record<string, { id: string; subject?: string; participants?: unknown[] }>>;
  requestPairingCode(phone: string): Promise<string>;
  end(error?: Error): void;
}

export interface AuthBundle {
  /** Estado de autenticação no formato do Baileys (creds + keys). */
  state: { creds: { registered?: boolean } & Record<string, unknown>; keys: unknown };
  saveCreds(): Promise<void>;
}

export type SocketFactory = (auth: AuthBundle) => WaSocket | Promise<WaSocket>;

export type WaStatus =
  | 'parado'
  | 'conectando'
  | 'aguardando_pareamento'
  | 'conectado'
  | 'reconectando'
  /** Sessão invalidada (deslogado, substituído, sessão ruim): só volta com novo pareamento. */
  | 'sessao_invalida'
  /** Servidor recusou o número (403): provável ban; trocar o chip. */
  | 'numero_bloqueado';

/** Mensagem de um grupo-fonte. Sem remetente, nome ou telefone de quem postou (LGPD). */
export interface SourceMessage {
  plataforma: 'whatsapp';
  grupoExternoId: string;
  mensagemExternaId: string;
  texto: string;
  publicadaEm: number;
}

/** Eco de uma mensagem nossa no grupo do cliente: insumo do reconciliador (incerto → enviado). */
export interface EchoMessage {
  grupoExternoId: string;
  mensagemExternaId: string;
  /** sha256 hex do texto (igual ao envios.texto_hash). */
  textoHash: string;
  em: number;
}

export interface OutgoingMessage {
  texto: string;
  mediaUrl: string | null;
}

export type SendOutcome =
  | { status: 'enviado'; mensagemId: string }
  /** Comprovadamente não saiu: nada foi entregue ao socket. */
  | { status: 'nao_transmitido'; motivo: string }
  /** Pode ter saído: nunca reenviar; o eco decide. */
  | { status: 'incerto'; motivo: string };

/**
 * desconectado: queda transitória que passou de 10 min (antes disso só reconecta).
 * sessao_invalidada: logout/sessão substituída ou corrompida → parear de novo.
 * numero_bloqueado: servidor recusou o número (403) → provável ban, trocar o chip.
 */
export type TipoExcecao = 'desconectado' | 'removido_do_grupo' | 'sessao_invalidada' | 'numero_bloqueado';

export interface ExceptionSink {
  open(e: { tipo: TipoExcecao; descricao: string; severidade: 'amarelo' | 'vermelho'; grupoExternoId?: string }): Promise<void>;
  resolve(tipo: TipoExcecao, grupoExternoId?: string): Promise<void>;
}

export interface WhatsAppConnector {
  connect(): Promise<void>;
  /** Código de 8 caracteres para digitar no celular (Aparelhos conectados → Conectar com número). */
  pairByCode(phone: string): Promise<string>;
  /** Conteúdo do QR (o PWA desenha). Muda a cada ~20 s; chame de novo para o próximo. */
  pairByQR(): Promise<string>;
  onMessage(handler: (m: SourceMessage) => void): () => void;
  onEcho(handler: (e: EchoMessage) => void): () => void;
  listGroups(): Promise<{ id: string; nome: string; participantes: number }[]>;
  sendToGroup(groupId: string, msg: OutgoingMessage, idempotencyKey: string, signal?: AbortSignal): Promise<SendOutcome>;
  status(): WaStatus;
  stop(): Promise<void>;
}
