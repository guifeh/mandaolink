export interface OperationState {
  semaforo: 'verde' | 'amarelo' | 'vermelho';
  pausado: boolean;
  excecoes: Array<{
    id: string;
    tipo: string;
    descricao: string;
    severidade?: 'amarelo' | 'vermelho';
    criada_em?: string;
  }>;
  enviosPendentes: number;
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

export function repairLink(tipo: string): string {
  if (tipo.includes('whatsapp') || tipo.includes('desconectado') || tipo === 'whatsapp_desconectado') {
    return '#pareamento';
  }
  if (tipo.includes('tag') || tipo.includes('afiliado') || tipo === 'tag_invalida') {
    return '#afiliado';
  }
  if (tipo.includes('limite') || tipo.includes('horario')) {
    return '#horarios';
  }
  return '#operacao';
}
