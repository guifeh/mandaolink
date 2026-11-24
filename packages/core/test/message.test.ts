import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  truncateTitle,
  formatPriceBRL,
  formatTimeSaoPaulo,
  renderMessage,
  validateMessage,
  extractUrls,
} from '../src/message.js';

test('truncateTitle corta em até 120 caracteres sem quebrar palavras', () => {
  const curto = 'Suporte Veicular Magnético';
  assert.equal(truncateTitle(curto, 120), curto);

  const longo =
    'Câmera Veicular Automotiva Dash Cam Full HD 1080p com Gravação Contínua em Loop Visão Noturna Aprimorada e Sensor de Colisão para Carros';
  const truncado = truncateTitle(longo, 120);

  assert.ok(truncado.length <= 123, `Tamanho truncado (${truncado.length}) deve ser <= 123 incluindo reticências`);
  assert.ok(truncado.endsWith('...'));
  assert.ok(!truncado.includes('  '));
  assert.ok(!/Notur\.\.\./.test(truncado));
});

test('formatPriceBRL formata valores em centavos para moeda Real brasileira', () => {
  assert.equal(formatPriceBRL(3990).replace(/\u00a0/g, ' '), 'R$ 39,90');
  assert.equal(formatPriceBRL(129900).replace(/\u00a0/g, ' '), 'R$ 1.299,00');
  assert.equal(formatPriceBRL(null, 'Preço promocional'), 'Preço promocional');
  assert.equal(formatPriceBRL(null), 'Consulte no link');
});

test('formatTimeSaoPaulo formata hora no fuso de São Paulo (UTC-3)', () => {
  // 18:30 UTC = 15:30 em São Paulo
  const dataUtc = new Date('2026-11-23T18:30:00Z');
  const horaSp = formatTimeSaoPaulo(dataUtc);
  assert.equal(horaSp, '15:30');
});

test('renderMessage produz estrutura completa com texto, link e mediaUrl', () => {
  const oferta = {
    titulo: 'Suporte Veicular Magnético para Painel e Saída de Ar',
    precoCents: 3990,
    link: 'https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20',
    imagemUrl: 'https://m.media-amazon.com/images/I/exemplo.jpg',
    verificadaEm: '2026-11-23T18:05:00Z',
    temCupom: false,
  };

  const rendered = renderMessage(oferta);

  assert.equal(rendered.mediaUrl, 'https://m.media-amazon.com/images/I/exemplo.jpg');
  assert.equal(rendered.temCupom, false);
  assert.ok(rendered.texto.includes('Suporte Veicular Magnético'));
  assert.ok(rendered.texto.includes('39,90'));
  assert.ok(/preço às 15:05, pode mudar/i.test(rendered.texto));
  assert.ok(rendered.texto.includes('https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20'));
  assert.ok(rendered.texto.endsWith('Link de afiliado'));
  assert.ok(!rendered.texto.includes('🎟️ Tem cupom na página'));
});

test('renderMessage inclui linha opcional de cupom apenas quando temCupom for true', () => {
  const ofertaComCupom = {
    titulo: 'Compressor de Ar Digital Portátil',
    precoCents: 8990,
    link: 'https://www.amazon.com.br/dp/B0EXEMPL43?tag=cliente-20',
    verificadaEm: '2026-11-23T18:10:00Z',
    temCupom: true,
  };

  const rendered = renderMessage(ofertaComCupom);
  assert.equal(rendered.temCupom, true);
  assert.ok(rendered.texto.includes('🎟️ Tem cupom na página'));
  assert.ok(rendered.texto.endsWith('Link de afiliado'));
});

test('validateMessage aprova mensagem renderizada válida', () => {
  const ourLink = 'https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20';
  const rendered = renderMessage({
    titulo: 'Carregador Veicular Rápido 30W USB-C',
    precoCents: 4990,
    link: ourLink,
    verificadaEm: '2026-11-23T18:10:00Z',
  });

  const validacao = validateMessage(rendered, ourLink);
  assert.equal(validacao.status, 'PASSA');
  assert.equal(validacao.valida, true);
});

test('validateMessage reprova termos proibidos "desconto" ou "por apenas"', () => {
  const ourLink = 'https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20';
  const msgComDesconto = [
    '🔥 Suporte Veicular',
    '',
    '💰 Compre com desconto por R$ 39,90',
    '⏱️ Preço às 15:00, pode mudar',
    '',
    `👉 Ver oferta: ${ourLink}`,
    'Link de afiliado',
  ].join('\n');

  const val1 = validateMessage(msgComDesconto, ourLink);
  assert.equal(val1.status, 'REPROVA');
  assert.ok(val1.detalhe?.includes('termo proibido'));

  const msgComPorApenas = [
    '🔥 Suporte Veicular',
    '',
    '💰 Por apenas R$ 39,90',
    '⏱️ Preço às 15:00, pode mudar',
    '',
    `👉 Ver oferta: ${ourLink}`,
    'Link de afiliado',
  ].join('\n');

  const val2 = validateMessage(msgComPorApenas, ourLink);
  assert.equal(val2.status, 'REPROVA');
  assert.ok(val2.detalhe?.includes('termo proibido'));
});

test('validateMessage reprova se faltar identificação "Link de afiliado"', () => {
  const ourLink = 'https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20';
  const msgSemDisclosure = [
    '🔥 Suporte Veicular',
    '',
    '💰 R$ 39,90',
    '⏱️ Preço às 15:00, pode mudar',
    '',
    `👉 Ver oferta: ${ourLink}`,
  ].join('\n');

  const validacao = validateMessage(msgSemDisclosure, ourLink);
  assert.equal(validacao.status, 'REPROVA');
  assert.equal(validacao.motivo, 'mensagem inválida');
  assert.ok(validacao.detalhe?.includes('Link de afiliado'));
});

test('validateMessage reprova se contiver links estranhos ou links de terceiros', () => {
  const ourLink = 'https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20';
  const textoComLinkAlheio = [
    '🔥 Suporte Veicular',
    '',
    '💰 R$ 39,90',
    '⏱️ Preço às 15:00, pode mudar',
    '',
    `👉 Ver oferta: ${ourLink}`,
    'Link de afiliado',
    'Acesse também nosso grupo: https://t.me/grupo_terceiro',
  ].join('\n');

  const validacao = validateMessage(textoComLinkAlheio, ourLink);
  assert.equal(validacao.status, 'REPROVA');
  assert.equal(validacao.motivo, 'mensagem inválida');
  assert.ok(validacao.detalhe?.includes('link(s) estranho(s)'));
});

test('validateMessage reprova se faltar o nosso link', () => {
  const ourLink = 'https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20';
  const textoSemLink = [
    '🔥 Suporte Veicular',
    '',
    '💰 R$ 39,90',
    '⏱️ Preço às 15:00, pode mudar',
    '',
    '👉 Ver oferta: sem link',
    'Link de afiliado',
  ].join('\n');

  const validacao = validateMessage(textoSemLink, ourLink);
  assert.equal(validacao.status, 'REPROVA');
  assert.equal(validacao.motivo, 'mensagem inválida');
});

test('validateMessage reprova se faltar a linha de horário do preço', () => {
  const ourLink = 'https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20';
  const textoSemHora = [
    '🔥 Suporte Veicular',
    '',
    '💰 R$ 39,90',
    '',
    `👉 Ver oferta: ${ourLink}`,
    'Link de afiliado',
  ].join('\n');

  const validacao = validateMessage(textoSemHora, ourLink);
  assert.equal(validacao.status, 'REPROVA');
  assert.equal(validacao.motivo, 'mensagem inválida');
  assert.ok(validacao.detalhe?.includes('Aviso obrigatório de horário'));
});

test('validateMessage reprova vazamento de texto não autorizado da fonte', () => {
  const ourLink = 'https://www.amazon.com.br/dp/B0EXEMPL01?tag=cliente-20';
  const fonteOriginal = ['CORRE QUE ESTA ACABANDO O ESTOQUE GALERA DO GRUPO VIP!', 'https://amzn.to/outro'].join('\n');

  const textoVazado = [
    'CORRE QUE ESTA ACABANDO O ESTOQUE GALERA DO GRUPO VIP!',
    '🔥 Suporte Veicular',
    '',
    '💰 R$ 39,90',
    '⏱️ Preço às 15:00, pode mudar',
    '',
    `👉 Ver oferta: ${ourLink}`,
    'Link de afiliado',
  ].join('\n');

  const validacao = validateMessage(textoVazado, ourLink, {
    fonteTextoParaVerificar: fonteOriginal,
  });

  assert.equal(validacao.status, 'REPROVA');
  assert.equal(validacao.motivo, 'mensagem inválida');
  assert.ok(validacao.detalhe?.includes('Vazamento de texto não autorizado'));
});
