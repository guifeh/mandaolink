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

export function repairLink(tipo: string, fonteId?: string | null): string {
  if (tipo === 'whatsapp_numero_bloqueado') return '/ajuda#numero-bloqueado';
  if (tipo === 'whatsapp_removido_do_grupo') return fonteId ? '/fontes' : '/ajuda#grupo-destino';
  if (tipo.includes('fonte')) return '/fontes';
  if (tipo.includes('whatsapp') || tipo.includes('desconectado') || tipo === 'whatsapp_desconectado') {
    return '/#pareamento';
  }
  if (tipo.includes('tag') || tipo.includes('afiliado') || tipo === 'tag_invalida') {
    return '/#afiliado';
  }
  if (tipo.includes('limite') || tipo.includes('horario')) {
    return '/#horarios';
  }
  if (tipo.includes('falha')) return '/ajuda#falhas';
  return '/ajuda';
}
