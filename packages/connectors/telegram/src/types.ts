// Contratos do conector Telegram. Só leitura: nenhum tipo aqui expõe envio.

/**
 * Mensagem de uma fonte Telegram. Mesmo formato do conector WhatsApp (S2), mudando a plataforma.
 * Sem remetente, nome, username ou telefone de quem postou (LGPD).
 * grupoExternoId = id "marcado" do chat como string (canal/supergrupo: "-100…"), igual ao da Bot API,
 * e deve ser o valor de fontes.identificador_externo.
 */
export interface SourceMessage {
  plataforma: 'telegram';
  grupoExternoId: string;
  mensagemExternaId: string;
  texto: string;
  publicadaEm: number;
}

export type TgStatus = 'parado' | 'conectando' | 'conectado' | 'reconectando' | 'sessao_invalida' | 'numero_bloqueado';

/**
 * desconectado: queda que passou de 10 min (antes disso só reconecta).
 * removido_do_grupo: o bot saiu/foi removido de uma fonte.
 * sessao_invalidada: token do bot revogado, sessão MTProto encerrada ou conflito de outra instância.
 * numero_bloqueado: a conta de usuário (MTProto) foi banida.
 */
export type TipoExcecao = 'desconectado' | 'removido_do_grupo' | 'sessao_invalidada' | 'numero_bloqueado';

export interface ExceptionSink {
  open(e: {
    tipo: TipoExcecao;
    descricao: string;
    severidade: 'amarelo' | 'vermelho';
    grupoExternoId?: string;
  }): Promise<void>;
  resolve(tipo: TipoExcecao, grupoExternoId?: string): Promise<void>;
}

/** Interface comum dos leitores (Bot API e MTProto). */
export interface TelegramSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (m: SourceMessage) => void): () => void;
  status(): TgStatus;
}

/** Fontes permitidas: só elas são lidas. Array fixo ou função (lida do banco a cada uso). */
export type Allowlist = string[] | (() => Promise<string[]> | string[]);
