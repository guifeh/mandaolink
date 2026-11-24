export interface ExceptionRow { id: string; tipo: string; descricao: string; severidade: string }
export interface OperationState { pausado: boolean; semaforo: 'verde' | 'amarelo' | 'vermelho'; excecoes: ExceptionRow[]; enviosPendentes: number }
export interface HistoryRow { id: string; titulo: string | null; id_loja: string; estado: string; simulado: boolean; motivo_descarte: string | null; motivo_legivel?: string | null; criado_em: string }
export const statusText = { verde: 'Tudo certo', amarelo: 'Precisa de atenção', vermelho: 'Operação interrompida' };
export function repairLink(type: string): string {
  if (/whatsapp|sessao|pareamento/.test(type)) return '#pareamento';
  if (/tag|afiliado/.test(type)) return '#afiliado';
  if (/horario|limite/.test(type)) return '#horarios';
  return '#nicho';
}
