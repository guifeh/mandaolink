export interface OfertaParaRender {
  titulo: string;
  precoCents: number | null;
  precoTexto?: string | null;
  link: string;
  imagemUrl?: string | null;
  verificadaEm?: string | Date;
  temCupom?: boolean;
}

export interface RenderOptions {
  maxTituloLen?: number;
  timeZone?: string;
  templateFn?: (dados: DadosTemplate) => string;
}

export interface DadosTemplate {
  titulo: string;
  precoFormatado: string;
  horaFormatada: string;
  link: string;
  temCupom?: boolean;
}

export interface RenderedMessage {
  texto: string;
  mediaUrl: string | null;
  tituloCurto: string;
  precoFormatado: string;
  horaPreco: string;
  linkAfiliado: string;
  temCupom: boolean;
}

export interface MessageValidationResult {
  status: 'PASSA' | 'REPROVA';
  valida: boolean;
  motivo?: 'mensagem inválida';
  detalhe?: string;
}

/**
 * Trunca o título em aproximadamente `maxLength` caracteres sem cortar palavras ao meio.
 */
export function truncateTitle(title: string, maxLength = 120): string {
  if (!title) return '';
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const sub = trimmed.slice(0, maxLength);
  const lastSpace = sub.lastIndexOf(' ');
  if (lastSpace > 0) {
    return `${sub.slice(0, lastSpace).trim()}...`;
  }
  return `${sub.trim()}...`;
}

/**
 * Formata centavos em moeda Real (BRL), ex: 3990 -> "R$ 39,90"
 */
export function formatPriceBRL(cents: number | null | undefined, fallbackText?: string | null): string {
  if (cents !== null && cents !== undefined && !Number.isNaN(cents) && cents >= 0) {
    const reais = (cents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    return reais;
  }
  if (fallbackText) return fallbackText;
  return 'Consulte no link';
}

/**
 * Formata o horário da verificação do preço no fuso horário 'America/Sao_Paulo' (HH:MM).
 */
export function formatTimeSaoPaulo(dateInput?: string | Date | number, timeZone = 'America/Sao_Paulo'): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = Number.isNaN(d.getTime()) ? new Date() : d;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(validDate);
}

/**
 * Template padrão aprovado pelo PO para o MandaoLink (WhatsApp/Telegram).
 * Diretrizes:
 * - Título claro
 * - Preço da página oficial (sem descontar cupom)
 * - Aviso de horário do preço ("preço às HH:MM, pode mudar")
 * - Linha "🎟️ Tem cupom na página" apenas quando temCupom = true
 * - Chamada "👉 Ver oferta: {link}"
 * - Linha final obrigatória: "Link de afiliado"
 * - Sem "Por apenas" e sem "Compre com desconto"
 */
export const DEFAULT_TEMPLATE = (d: DadosTemplate): string => {
  const lines: string[] = [
    `🔥 ${d.titulo}`,
    ``,
    `💰 ${d.precoFormatado}`,
    `⏱️ Preço às ${d.horaFormatada}, pode mudar`,
  ];

  if (d.temCupom) {
    lines.push(`🎟️ Tem cupom na página`);
  }

  lines.push(
    ``,
    `👉 Ver oferta: ${d.link}`,
    `Link de afiliado`
  );

  return lines.join('\n');
};

/**
 * Renderiza a mensagem final para envio a partir dos dados da oferta.
 */
export function renderMessage(
  oferta: OfertaParaRender,
  options: RenderOptions = {}
): RenderedMessage {
  const maxTitulo = options.maxTituloLen ?? 120;
  const timeZone = options.timeZone ?? 'America/Sao_Paulo';
  const templateFn = options.templateFn ?? DEFAULT_TEMPLATE;

  const tituloCurto = truncateTitle(oferta.titulo, maxTitulo);
  const precoFormatado = formatPriceBRL(oferta.precoCents, oferta.precoTexto);
  const horaPreco = formatTimeSaoPaulo(oferta.verificadaEm, timeZone);
  const linkAfiliado = oferta.link.trim();
  const temCupom = Boolean(oferta.temCupom);

  const texto = templateFn({
    titulo: tituloCurto,
    precoFormatado,
    horaFormatada: horaPreco,
    link: linkAfiliado,
    temCupom,
  });

  return {
    texto,
    mediaUrl: oferta.imagemUrl ?? null,
    tituloCurto,
    precoFormatado,
    horaPreco,
    linkAfiliado,
    temCupom,
  };
}

/**
 * Extrai todas as URLs completas de um texto.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? [];
  return [...new Set(matches.map((u) => u.replace(/[.,;:!?]+$/, '')))];
}

/**
 * Gate G8: Valida se a mensagem gerada respeita todas as políticas de qualidade e compliance:
 * 1. O único link presente na mensagem deve ser o nosso link de afiliado.
 * 2. Contém todos os campos obrigatórios (título, preço, aviso de horário, link, e identificação "Link de afiliado").
 * 3. Não contém termos proibidos ("desconto" ou "por apenas").
 * 4. Tamanho total respeita o limite do canal (padrão 1024 caracteres).
 * 5. Não contém vazamento de texto não autorizado da fonte original de terceiros.
 */
export function validateMessage(
  msg: string | RenderedMessage,
  ourLink: string,
  options: {
    maxCharacters?: number;
    fonteTextoParaVerificar?: string;
  } = {}
): MessageValidationResult {
  const maxChars = options.maxCharacters ?? 1024;
  const texto = typeof msg === 'string' ? msg : msg.texto;

  if (!texto || texto.trim().length === 0) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: 'Mensagem vazia',
    };
  }

  // 1. Limite de tamanho
  if (texto.length > maxChars) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: `Mensagem excede o tamanho máximo de ${maxChars} caracteres (atual: ${texto.length})`,
    };
  }

  // 2. Termos recusados no template ("desconto" ou "por apenas")
  if (/desconto|por apenas/i.test(texto)) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: 'Mensagem contém termo proibido no template ("desconto" ou "por apenas")',
    };
  }

  // 3. Exigência da linha obrigatória de disclosure de afiliado
  if (!/\bLink de afiliado\b/i.test(texto)) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: 'Identificação obrigatória "Link de afiliado" ausente na mensagem',
    };
  }

  // 4. Extrai e valida URLs
  const urls = extractUrls(texto);
  if (urls.length === 0) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: 'Mensagem não contém link de afiliado',
    };
  }

  const cleanOurLink = ourLink.trim();
  const hasOurLink = urls.some((u) => u === cleanOurLink);
  if (!hasOurLink) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: 'O nosso link de afiliado não foi encontrado na mensagem',
    };
  }

  // Se houver qualquer outro link que não seja exatamente o nosso link oficial
  const rogueUrls = urls.filter((u) => u !== cleanOurLink);
  if (rogueUrls.length > 0) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: `Mensagem contém link(s) estranho(s) não autorizado(s): ${rogueUrls.join(', ')}`,
    };
  }

  // 5. Validação dos campos obrigatórios
  const hasTimeNotice = /preço às \d{2}:\d{2}, pode mudar/i.test(texto);
  if (!hasTimeNotice) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: 'Aviso obrigatório de horário do preço ("preço às HH:MM, pode mudar") ausente',
    };
  }

  const hasPrice = /R\$\s*\d+,\d{2}|Consulte no link/i.test(texto);
  if (!hasPrice) {
    return {
      status: 'REPROVA',
      valida: false,
      motivo: 'mensagem inválida',
      detalhe: 'Indicação de preço ausente ou com formato inválido',
    };
  }

  // 6. Verificação de vazamento de texto da fonte
  if (options.fonteTextoParaVerificar) {
    const rawFonte = options.fonteTextoParaVerificar.trim();
    // Se a fonte continha frases promocionais típicas de terceiros (ex: "corre que tá acabando", "grupo vip")
    // e essas frases foram parar integralmente na mensagem
    const trechosSuspeitos = rawFonte
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= 25 && !l.startsWith('http'));

    for (const trecho of trechosSuspeitos) {
      if (texto.includes(trecho)) {
        return {
          status: 'REPROVA',
          valida: false,
          motivo: 'mensagem inválida',
          detalhe: `Vazamento de texto não autorizado da fonte detectado: "${trecho.slice(0, 40)}..."`,
        };
      }
    }
  }

  return {
    status: 'PASSA',
    valida: true,
  };
}
