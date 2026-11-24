export type DecisionLabel = 'enviar' | 'nao_enviar';

export type GateCode =
  | 'G0'
  | 'G1'
  | 'G2'
  | 'G3'
  | 'G4'
  | 'G5'
  | 'G6'
  | 'G7'
  | 'G8'
  | 'G9';

export interface MensagemFonte {
  id: string;
  plataforma: 'whatsapp' | 'telegram';
  ativa: boolean;
}

export interface MensagemRaw {
  texto: string;
  link: string | null;
  fonte: MensagemFonte;
  publicadaEm: string;
}

export interface CupomInfo {
  presente: boolean;
  legivel: boolean;
  valorCentavos?: number;
  percentual?: number;
}

export interface ContextoOferta {
  asin?: string;
  agora?: string;
  tagAmazon?: string;
  categoria?: string;
  jaEnviadoJanela24h?: boolean;
  disponivel?: boolean;
  tituloOficial?: string;
  precoAtualCents?: number | null;
  precoAnunciadoCents?: number | null;
  tempoNaFilaMinutos?: number;
  ttlMinutos?: number;
  mensagemRenderizadaComErro?: string;
  cupom?: CupomInfo | null;
}

export interface ReferenceCase {
  id: string;
  tipo: 'exemplo';
  descricao: string;
  mensagem: MensagemRaw;
  contexto?: ContextoOferta;
  esperado: {
    rotulo: DecisionLabel;
    motivo: string | null;
    gateEsperado: GateCode | null;
  };
}

export interface PipelineDecision {
  rotulo: DecisionLabel;
  motivo?: string | null;
  gate?: GateCode | string | null;
}

export type PipelineFunction = (
  caso: ReferenceCase
) => Promise<PipelineDecision> | PipelineDecision;

export interface Discrepancia {
  id: string;
  descricao: string;
  gateEsperado: GateCode | null;
  esperado: {
    rotulo: DecisionLabel;
    motivo: string | null;
  };
  obtido: {
    rotulo: DecisionLabel;
    motivo: string | null;
    gate?: string | null;
  };
  tipoDiscrepancia: 'rotulo' | 'motivo' | 'ambos';
}

export interface GateMetrics {
  total: number;
  acertosRotulo: number;
  acertosMotivo: number;
}

export interface ContadoresObtidos {
  ofertaVencida: number;
  cupomIlegivel: number;
  [motivo: string]: number;
}

export interface EvaluationReport {
  totalCasos: number;
  acertosRotulo: number;
  acertosMotivo: number;
  taxaAcertoRotulo: number;
  taxaAcertoMotivo: number;
  falsosPositivos: number;
  falsosNegativos: number;
  porGate: Record<string, GateMetrics>;
  contadoresObtidos: ContadoresObtidos;
  discrepancias: Discrepancia[];
}
