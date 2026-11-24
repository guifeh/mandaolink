export interface OperationState {
  semaforo: 'verde' | 'amarelo' | 'vermelho';
  pausado: boolean;
  excecoes: Array<{
    id: string;
    tipo: string;
    descricao: string;
    severidade?: 'amarelo' | 'vermelho';
    criada_em?: string;
    fonte_id?: string | null;
  }>;
  enviosPendentes: number;
}

export interface PendingState {
  excecoes: OperationState['excecoes'];
  envios: Array<{ id: string; estado: 'falhou' | 'incerto'; erro: string | null }>;
}

export interface HistoryRow {
  id: string;
  titulo?: string;
  id_loja?: string;
  estado: string;
  simulado?: boolean;
  criado_em: string;
  enviado_em?: string | null;
  motivo_descarte?: string | null;
  motivo_legivel?: string | null;
}

export const statusText = {
  verde: 'Operação normal',
  amarelo: 'Atenção necessária',
  vermelho: 'Operação interrompida',
} as const;

export type TipoExcecao =
  | 'fonte_perdida'
  | 'whatsapp_removido_do_grupo'
  | 'whatsapp_numero_bloqueado'
  | 'whatsapp_sessao_invalidada'
  | 'whatsapp_desconectado'
  | 'tag_invalida'
  | 'limite'
  | 'horario_invalido'
  | 'muitas_falhas'
  | 'pausado_por_falhas';

const repairRoutes: Record<TipoExcecao, string> = {
  fonte_perdida: '/fontes',
  whatsapp_removido_do_grupo: '/ajuda#grupo-destino',
  whatsapp_numero_bloqueado: '/ajuda#numero-bloqueado',
  whatsapp_sessao_invalidada: '/#pareamento',
  whatsapp_desconectado: '/#pareamento',
  tag_invalida: '/#afiliado',
  limite: '/#horarios',
  horario_invalido: '/#horarios',
  muitas_falhas: '/ajuda#falhas',
  pausado_por_falhas: '/ajuda#falhas',
};

function isTipoExcecao(tipo: string): tipo is TipoExcecao {
  return Object.hasOwn(repairRoutes, tipo);
}

export function repairLink(tipo: string, fonteId?: string | null): string {
  if (!isTipoExcecao(tipo)) return '/ajuda';
  if (tipo === 'whatsapp_removido_do_grupo' && fonteId) return '/fontes';
  return repairRoutes[tipo];
}
