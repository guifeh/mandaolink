import { traduzirMotivo } from './motivosLegiveis.js';

export interface MotivoContagem {
  motivo: string;
  quantidade: number;
}

export interface DadosResumoDiario {
  enviadas: number;
  descartadas: number;
  motivosPrincipais?: MotivoContagem[];
  tempoParadoMinutos?: number;
  pendenciasAbertas?: number;
}

/**
 * Formata uma data no fuso de São Paulo (DD/MM/AAAA)
 */
export function formatarDataBrasilia(dataInput?: string | Date): string {
  if (!dataInput) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date());
  }

  // Se for string no formato YYYY-MM-DD simples, monta Date de meio-dia UTC para evitar deslocamento de fuso
  let d: Date;
  if (typeof dataInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dataInput)) {
    const [ano, mes, dia] = dataInput.split('-').map(Number);
    d = new Date(Date.UTC(ano, mes - 1, dia, 12, 0, 0));
  } else {
    d = new Date(dataInput);
  }

  const validDate = Number.isNaN(d.getTime()) ? new Date() : d;

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(validDate);
}

/**
 * Gera o texto do resumo diário para o WhatsApp pessoal do cliente.
 * Regras:
 * - Sem termos técnicos
 * - Curto (máximo ~8 linhas)
 * - Fuso America/Sao_Paulo
 * - Contém: enviadas, descartadas, top 3 motivos legíveis, tempo parado e pendências abertas.
 */
export function buildDailySummary(
  dados: DadosResumoDiario,
  dataInput?: string | Date
): string {
  const dataFormatada = formatarDataBrasilia(dataInput);
  const linhas: string[] = [];

  // Linha 1: Cabeçalho com data
  linhas.push(`📊 Resumo MandaoLink — ${dataFormatada}`);
  linhas.push(``);

  // Linha 2 e 3: Balanço de envios
  linhas.push(`✅ ${dados.enviadas} ${dados.enviadas === 1 ? 'oferta enviada' : 'ofertas enviadas'}`);
  linhas.push(`🚫 ${dados.descartadas} ${dados.descartadas === 1 ? 'descartada' : 'descartadas'}`);

  // Linha 4 e 5: Top 3 motivos de descarte mais frequentes
  if (dados.motivosPrincipais && dados.motivosPrincipais.length > 0) {
    const top3 = dados.motivosPrincipais
      .slice(0, 3)
      .map((item) => {
        const frase = traduzirMotivo(item.motivo);
        return `• ${frase} (${item.quantidade})`;
      });

    linhas.push(``);
    linhas.push(`Principais motivos:`);
    linhas.push(...top3);
  }

  // Linha 6: Tempo parado (se houve) ou funcionamento contínuo
  linhas.push(``);
  const paradoMin = dados.tempoParadoMinutos ?? 0;
  if (paradoMin > 0) {
    if (paradoMin >= 60) {
      const horas = Math.floor(paradoMin / 60);
      const minRest = paradoMin % 60;
      linhas.push(`⏸️ Pausado por ${horas}h${minRest > 0 ? ` ${minRest}min` : ''}`);
    } else {
      linhas.push(`⏸️ Pausado por ${paradoMin} min`);
    }
  } else {
    linhas.push(`⏱️ Funcionamento contínuo`);
  }

  // Linha 7: Pendências abertas
  const pendencias = dados.pendenciasAbertas ?? 0;
  if (pendencias > 0) {
    linhas.push(`⚠️ ${pendencias} ${pendencias === 1 ? 'pendência para revisar' : 'pendências para revisar'}`);
  } else {
    linhas.push(`✨ Nenhuma pendência aberta`);
  }

  return linhas.join('\n');
}
