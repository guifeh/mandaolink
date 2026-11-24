export interface NicheFilterConfig {
  nome?: string;
  palavras_chave: string[];
  palavras_bloqueadas: string[];
  categorias?: string[];
}

export type NicheGateResult =
  | {
      status: 'PASSA';
      motivo?: null;
      termoCasado?: string;
    }
  | {
      status: 'REPROVA';
      motivo: 'fora_do_nicho' | 'palavra_bloqueada';
      motivoDescritivo: 'fora do nicho' | 'palavra bloqueada';
      termo?: string;
    };

/**
 * Normaliza o texto removendo acentuações, passando para minúsculas e
 * colapsando múltiplos espaços.
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Constrói um RegExp para casamento de palavra inteira ou expressão completa,
 * aceitando variação simples de plural (ex: carro/carros, acessorio/acessorios).
 */
export function buildTermRegex(term: string): RegExp {
  const normTerm = normalizeText(term);
  if (!normTerm) return /(?!)/;

  const words = normTerm.split(' ').map((w) => {
    const escaped = escapeRegex(w);
    if (!w.endsWith('s')) {
      return `${escaped}(?:s)?`;
    }
    return `${escaped.slice(0, -1)}(?:s)?`;
  });

  const phrasePattern = words.join('\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${phrasePattern}(?:[^a-z0-9]|$)`, 'i');
}

/**
 * Gate G5: Valida se o título oficial do produto e sua categoria pertencem ao nicho configurado.
 * Regras:
 * 1. Aplicado estritamente sobre o título oficial do produto (nunca sobre o texto da fonte).
 * 2. Se a categoria da loja for informada e a lista de categorias do nicho não for vazia,
 *    a categoria do produto precisa estar contida na lista do nicho.
 * 3. Normaliza sem acentos, minúsculas e espaços colapsados.
 * 4. Lista de bloqueio tem precedência total sobre palavras positivas.
 * 5. Pelo menos uma palavra-chave positiva deve casar inteira; sem sinal positivo claro, reprova.
 */
export function nicheGate(
  title: string | null | undefined,
  config: NicheFilterConfig,
  categoria?: string | null,
): NicheGateResult {
  if (!title || typeof title !== 'string') {
    return {
      status: 'REPROVA',
      motivo: 'fora_do_nicho',
      motivoDescritivo: 'fora do nicho',
    };
  }

  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) {
    return {
      status: 'REPROVA',
      motivo: 'fora_do_nicho',
      motivoDescritivo: 'fora do nicho',
    };
  }

  // 1. Verifica lista de bloqueio (precedência máxima absoluta)
  if (config.palavras_bloqueadas && config.palavras_bloqueadas.length > 0) {
    for (const termoBloqueado of config.palavras_bloqueadas) {
      if (!termoBloqueado) continue;
      const re = buildTermRegex(termoBloqueado);
      if (re.test(normalizedTitle)) {
        return {
          status: 'REPROVA',
          motivo: 'palavra_bloqueada',
          motivoDescritivo: 'palavra bloqueada',
          termo: termoBloqueado,
        };
      }
    }
  }

  // 2. Se categorias do nicho forem configuradas e o produto tiver categoria informada, valida pertinência
  if (config.categorias && config.categorias.length > 0 && categoria) {
    const normCategoria = normalizeText(categoria);
    const categoriasPermitidasNorm = config.categorias.map(normalizeText);
    const categoriaValida = categoriasPermitidasNorm.some(
      (cat) => cat === normCategoria || normCategoria.includes(cat),
    );
    if (!categoriaValida) {
      return {
        status: 'REPROVA',
        motivo: 'fora_do_nicho',
        motivoDescritivo: 'fora do nicho',
        termo: categoria,
      };
    }
  }

  // 3. Verifica palavras-chave positivas
  let termoPositivoCasado: string | undefined;
  if (config.palavras_chave && config.palavras_chave.length > 0) {
    for (const termoChave of config.palavras_chave) {
      if (!termoChave) continue;
      const re = buildTermRegex(termoChave);
      if (re.test(normalizedTitle)) {
        termoPositivoCasado = termoChave;
        break;
      }
    }
  }

  // 4. Sem palavra-chave positiva válida -> fora do nicho ("na dúvida, não envia")
  if (!termoPositivoCasado) {
    return {
      status: 'REPROVA',
      motivo: 'fora_do_nicho',
      motivoDescritivo: 'fora do nicho',
    };
  }

  return {
    status: 'PASSA',
    termoCasado: termoPositivoCasado,
  };
}

/**
 * Configuração padrão para o nicho "Carro"
 */
export const DEFAULT_CAR_NICHE_CONFIG: NicheFilterConfig = {
  nome: 'Carro',
  palavras_chave: [
    'carro',
    'veiculo',
    'veicular',
    'automotivo',
    'automotiva',
    'automovel',
    'painel',
    'retrovisor',
    'porta-malas',
    'pneu',
    'calibrador',
    'farol',
    'bateria automotiva',
    'cera automotiva',
    'radiador',
    'volante',
    'tapete automotivo',
    'oleo motor',
    'lavagem automotiva',
    'aromatizador veicular',
    'acessorio automotivo',
    'dashcam',
    'camera veicular',
    'ignicao',
    'lataria',
  ],
  palavras_bloqueadas: [
    'carro de brinquedo',
    'carrinho de bebe',
    'carrinho de controle remoto',
    'hot wheels',
    'carrinho eletrico infantil',
    'miniatura',
    'brinquedo',
    'jogo de tabuleiro',
    'jogo de cartas',
    'tabuleiro',
    'barbie',
    'carrinho de boneca',
    'carrinho de compras',
    'carrinho de feira',
    'carrinho organizador',
  ],
  categorias: [
    'automotivo',
    'pecas e acessorios automotivos',
    'ferramentas automotivas',
    'eletronicos para veiculos',
    'pneus e rodas',
  ],
};
