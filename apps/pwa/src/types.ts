export interface NicheConfig {
  id?: number;
  nome: string;
  palavras_chave: string[];
  palavras_bloqueadas: string[];
  categorias: string[];
  tag_amazon: string;
  limite_hora: number;
  limite_dia: number;
  horario_inicio: string;
  horario_fim: string;
  pausado?: boolean;
  atualizado_em?: string;
}

export interface ApiError {
  erro: string;
}
