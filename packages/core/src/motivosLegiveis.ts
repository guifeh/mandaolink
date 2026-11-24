/**
 * Mapa centralizado de tradução de códigos de motivos dos gates (G0-G9)
 * e estados operacionais para frases curtas em linguagem natural.
 * Utilizado no resumo diário do cliente (WhatsApp) e no histórico operacional.
 */
export const MAPA_MOTIVOS_LEGIVEIS: Record<string, string> = {
  // Gate G0
  'fonte inativa': 'Grupo ou canal desativado',
  fonte_inativa: 'Grupo ou canal desativado',
  'mensagem antiga': 'Mensagem antiga na origem',
  mensagem_antiga: 'Mensagem antiga na origem',

  // Gate G1
  'sem link': 'Mensagem sem link',
  sem_link: 'Mensagem sem link',

  // Gate G2
  'loja não suportada': 'Loja não suportada',
  loja_nao_suportada: 'Loja não suportada',
  'link não resolve': 'Link quebrado ou inválido',
  link_nao_resolve: 'Link quebrado ou inválido',

  // Gate G3
  repetida: 'Oferta já enviada recentemente',

  // Gate G4
  indisponível: 'Produto esgotado ou indisponível',
  indisponivel: 'Produto esgotado ou indisponível',
  produto_inexistente: 'Produto não encontrado na loja',
  asin_invalido: 'Código de produto inválido',
  http_404: 'Página não encontrada',

  // Gate G5
  'fora do nicho': 'Não é do nicho',
  fora_do_nicho: 'Não é do nicho',
  'palavra bloqueada': 'Contém palavra proibida',
  palavra_bloqueada: 'Contém palavra proibida',

  // Gate G6
  'oferta vencida': 'Preço subiu ou oferta acabou',
  oferta_vencida: 'Preço subiu ou oferta acabou',
  cupom_ilegivel: 'Cupom sem valor visível',
  'cupom ilegível': 'Cupom sem valor visível',
  'cupom ilegivel': 'Cupom sem valor visível',
  cupom_sem_valor: 'Cupom sem valor visível',

  // Gate G7
  'falha ao gerar link': 'Falha ao gerar link de afiliado',
  falha_ao_gerar_link: 'Falha ao gerar link de afiliado',

  // Gate G8
  'mensagem inválida': 'Mensagem fora do padrão de envio',
  mensagem_invalida: 'Mensagem fora do padrão de envio',

  // Gate G9
  'vencida na fila': 'Perdeu a validade esperando',
  vencida_na_fila: 'Perdeu a validade esperando',

  // Estados e motivos operacionais
  falhou: 'Falha no envio da mensagem',
  'falha de leitura': 'Não foi possível ler a página do produto',
  falha_de_leitura: 'Não foi possível ler a página do produto',
  incerto: 'Envio pendente de confirmação',
  descartado: 'Descartada antes do envio',
  pausado: 'Envios pausados pelo operador',
};

export const MOTIVO_GENERICO_PADRAO = 'Descartada pelo filtro';

/**
 * Traduz um código de gate ou erro para uma frase amigável sem termos técnicos.
 */
export function traduzirMotivo(codigo: string | null | undefined): string {
  if (!codigo) return MOTIVO_GENERICO_PADRAO;
  const normalizado = codigo.trim().toLowerCase();
  return MAPA_MOTIVOS_LEGIVEIS[normalizado] ?? MOTIVO_GENERICO_PADRAO;
}
