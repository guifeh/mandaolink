import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost:5173',
});

// @ts-expect-error polyfill globals for jsdom
globalThis.window = dom.window;
globalThis.document = dom.window.document;

for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key in globalThis) continue;
  try {
    Object.defineProperty(globalThis, key, {
      value: (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    });
  } catch {}
}

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import type { ApiClient } from '../src/api/client.js';
import type { NicheConfig } from '../src/types.js';
import { NicheConfigPage } from '../src/pages/NicheConfig.js';
import { ScheduleLimitsPage } from '../src/pages/ScheduleLimits.js';
import { AffiliateAccountPage } from '../src/pages/AffiliateAccount.js';

const { render, screen, cleanup, fireEvent, waitFor } = await import('@testing-library/react');

afterEach(() => {
  cleanup();
});

function createMockApiClient(initialConfig: Partial<NicheConfig> = {}, shouldFailUpdate = false) {
  const currentConfig: NicheConfig = {
    nome: 'Carro',
    palavras_chave: ['suporte veicular', 'pneu'],
    palavras_bloqueadas: ['brinquedo'],
    categorias: ['automotivo'],
    tag_amazon: 'meucanal-20',
    limite_hora: 5,
    limite_dia: 30,
    horario_inicio: '08:00',
    horario_fim: '22:00',
    ...initialConfig,
  };

  const updateCalls: Partial<NicheConfig>[] = [];

  const client = {
    async fetchConfig() {
      return { ...currentConfig };
    },
    async updateConfig(partial: Partial<NicheConfig>) {
      if (shouldFailUpdate) {
        throw new Error('Falha no servidor (HTTP 500 Internal Server Error)');
      }
      updateCalls.push(partial);
      Object.assign(currentConfig, partial);
      return { ...currentConfig };
    },
  } as unknown as ApiClient & { updateCalls: Partial<NicheConfig>[] };

  client.updateCalls = updateCalls;
  return client;
}

test('B1 (Nicho): adiciona palavra com salvamento instantâneo e feedback "Salvo"', async () => {
  const client = createMockApiClient({ palavras_chave: ['veicular'] });
  render(React.createElement(NicheConfigPage, { apiClient: client }));

  await waitFor(() => {
    assert.ok(screen.getByText('veicular'));
  });

  const input = screen.getByLabelText('Adicionar ao nicho');
  fireEvent.change(input, { target: { value: 'calibrador' } });

  const form = input.closest('form')!;
  fireEvent.submit(form);

  await waitFor(() => {
    assert.ok(screen.getByText('calibrador'));
    assert.ok(screen.getByText('Salvo'));
  });

  assert.equal(client.updateCalls.length, 1);
  assert.deepEqual(client.updateCalls[0].palavras_chave, ['veicular', 'calibrador']);
});

test('B1 (Nicho): remove palavra com salvamento instantâneo e ação "Desfazer"', async () => {
  const client = createMockApiClient({ palavras_chave: ['pneu'] });
  render(React.createElement(NicheConfigPage, { apiClient: client }));

  await waitFor(() => {
    assert.ok(screen.getByText('pneu'));
  });

  const btnRemover = screen.getByLabelText('Remover pneu');
  fireEvent.click(btnRemover);

  await waitFor(() => {
    assert.equal(screen.queryByText('pneu'), null);
    assert.ok(screen.getByText('“pneu” removida.'));
    assert.ok(screen.getByRole('button', { name: 'Desfazer' }));
  });

  assert.equal(client.updateCalls.length, 1);
  assert.deepEqual(client.updateCalls[0].palavras_chave, []);

  // Clica em "Desfazer" para recuperar a palavra removida
  const btnDesfazer = screen.getByRole('button', { name: 'Desfazer' });
  fireEvent.click(btnDesfazer);

  await waitFor(() => {
    assert.ok(screen.getByText('pneu'));
  });

  assert.equal(client.updateCalls.length, 2);
  assert.deepEqual(client.updateCalls[1].palavras_chave, ['pneu']);
});

test('B1 (Nicho): rollback e mensagem amigável sem detalhes técnicos como (HTTP ...) em caso de erro', async () => {
  const client = createMockApiClient({ palavras_chave: ['chave'] }, true);
  render(React.createElement(NicheConfigPage, { apiClient: client }));

  await waitFor(() => {
    assert.ok(screen.getByText('chave'));
  });

  const input = screen.getByLabelText('Adicionar ao nicho');
  fireEvent.change(input, { target: { value: 'lampada' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    // Rollback: lampada não está na lista
    assert.equal(screen.queryByText('lampada'), null);
    assert.ok(screen.getByText('chave'));

    const feedback = screen.getByRole('alert');
    assert.ok(feedback.textContent?.includes('Não deu para salvar “lampada”. Confira a internet e tente de novo.'));
    // Sem jargão técnico HTTP
    assert.ok(!feedback.textContent?.includes('(HTTP'));
  });
});

test('B1 (Nicho): acessibilidade - rótulos visíveis, aria-describedby, touch target 44px e sem botão salvar', async () => {
  const client = createMockApiClient({ palavras_chave: ['vela'] });
  render(React.createElement(NicheConfigPage, { apiClient: client }));

  await waitFor(() => {
    assert.ok(screen.getByText('vela'));
  });

  // Label associado ao input do nicho
  const labelNicho = screen.getByText('Adicionar ao nicho');
  assert.equal(labelNicho.getAttribute('for'), 'input-palavra-nicho');

  // Botão de remover tem touch target com classe .tag-remove e aria-label
  const btnRemove = screen.getByLabelText('Remover vela');
  assert.ok(btnRemove.classList.contains('tag-remove'));

  // Erro inline tem aria-invalid e aria-describedby
  const input = screen.getByLabelText('Adicionar ao nicho');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(input.getAttribute('aria-describedby'), 'erro-input-nicho');
    assert.ok(screen.getByText('Informe uma palavra para adicionar ao nicho.'));
  });

  // Sem botão de salvar geral
  assert.equal(screen.queryByText('Salvar alterações'), null);
});

test('B2 (Horários): botão de salvar aparece apenas quando há alterações', async () => {
  const client = createMockApiClient({
    horario_inicio: '08:00',
    horario_fim: '22:00',
    limite_hora: 5,
    limite_dia: 30,
  });

  render(React.createElement(ScheduleLimitsPage, { apiClient: client }));

  await waitFor(() => {
    assert.ok(screen.getByLabelText('Início do envio'));
  });

  // Sem alterações inicialmente: botão não é renderizado
  assert.equal(screen.queryByText('Salvar alterações'), null);

  // Altera um campo
  const inputInicio = screen.getByLabelText('Início do envio');
  fireEvent.change(inputInicio, { target: { value: '09:00' } });

  // Botão aparece
  await waitFor(() => {
    assert.ok(screen.getByText('Salvar alterações'));
  });

  // Reverte para o original
  fireEvent.change(inputInicio, { target: { value: '08:00' } });

  // Botão desaparece
  await waitFor(() => {
    assert.equal(screen.queryByText('Salvar alterações'), null);
  });
});

test('B2 (Horários): janela overnight (início > fim) é válida e exibe "termina no dia seguinte"', async () => {
  const client = createMockApiClient({
    horario_inicio: '18:00',
    horario_fim: '22:00',
  });

  render(React.createElement(ScheduleLimitsPage, { apiClient: client }));

  await waitFor(() => {
    assert.ok(screen.getByLabelText('Início do envio'));
  });

  const inputFim = screen.getByLabelText('Término do envio');
  fireEvent.change(inputFim, { target: { value: '02:00' } });

  await waitFor(() => {
    assert.ok(screen.getByText('termina no dia seguinte'));
  });

  const btnSalvar = screen.getByText('Salvar alterações');
  fireEvent.click(btnSalvar);

  await waitFor(() => {
    assert.ok(screen.getByText('Horários e limites salvos com sucesso!'));
  });

  assert.equal(client.updateCalls.length, 1);
  assert.equal(client.updateCalls[0].horario_inicio, '18:00');
  assert.equal(client.updateCalls[0].horario_fim, '02:00');
});

test('B2 (Horários): rejeição de horários iguais e limite hora > limite dia', async () => {
  const client = createMockApiClient({
    horario_inicio: '08:00',
    horario_fim: '22:00',
    limite_hora: 5,
    limite_dia: 30,
  });

  render(React.createElement(ScheduleLimitsPage, { apiClient: client }));

  await waitFor(() => {
    assert.ok(screen.getByLabelText('Início do envio'));
  });

  // Testa horários iguais
  const inputFim = screen.getByLabelText('Término do envio');
  fireEvent.change(inputFim, { target: { value: '08:00' } });

  const btnSalvar = screen.getByText('Salvar alterações');
  fireEvent.click(btnSalvar);

  await waitFor(() => {
    assert.ok(screen.getByText('Os horários de início e término devem ser diferentes.'));
    assert.equal(inputFim.getAttribute('aria-invalid'), 'true');
  });

  assert.equal(client.updateCalls.length, 0);

  // Testa limite hora > dia
  fireEvent.change(inputFim, { target: { value: '22:00' } });
  const inputHora = screen.getByLabelText('Máximo por hora');
  fireEvent.change(inputHora, { target: { value: '50' } });

  fireEvent.click(screen.getByText('Salvar alterações'));

  await waitFor(() => {
    assert.ok(screen.getByText('O limite por hora não pode ser maior que o limite diário.'));
    assert.equal(inputHora.getAttribute('aria-invalid'), 'true');
  });

  assert.equal(client.updateCalls.length, 0);
});

test('B3 (Afiliado): confirmação ao trocar tag existente e persistência', async () => {
  const client = createMockApiClient({ tag_amazon: 'meucanal-20' });
  render(React.createElement(AffiliateAccountPage, { apiClient: client }));

  await waitFor(() => {
    const input = screen.getByLabelText('ID de Associado (termina com -20)') as HTMLInputElement;
    assert.equal(input.value, 'meucanal-20');
  });

  const input = screen.getByLabelText('ID de Associado (termina com -20)');
  fireEvent.change(input, { target: { value: 'novocanal-20' } });

  const btnSalvar = screen.getByText('Salvar tag da Amazon');
  fireEvent.click(btnSalvar);

  // Confirmação é exibida
  await waitFor(() => {
    assert.ok(
      screen.getByText(
        'Trocar a tag muda para onde vão as comissões dos próximos envios. Os links já publicados continuam com a tag antiga. Continuar?',
      ),
    );
  });

  // Cancela
  fireEvent.click(screen.getByText('Cancelar'));

  await waitFor(() => {
    assert.equal(
      screen.queryByText(
        'Trocar a tag muda para onde vão as comissões dos próximos envios. Os links já publicados continuam com a tag antiga. Continuar?',
      ),
      null,
    );
    assert.equal((input as HTMLInputElement).value, 'meucanal-20');
  });

  // Muda novamente e confirma
  fireEvent.change(input, { target: { value: 'novocanal-20' } });
  fireEvent.click(screen.getByText('Salvar tag da Amazon'));

  await waitFor(() => {
    assert.ok(screen.getByText('Confirmar e salvar'));
  });

  fireEvent.click(screen.getByText('Confirmar e salvar'));

  await waitFor(() => {
    assert.ok(screen.getByText('Tag da Amazon salva com sucesso!'));
  });

  assert.equal(client.updateCalls.length, 1);
  assert.equal(client.updateCalls[0].tag_amazon, 'novocanal-20');
});

test('B3 (Afiliado): validação inline com aria-invalid/aria-describedby e mensagem amigável sem (HTTP ...)', async () => {
  const client = createMockApiClient({ tag_amazon: 'meucanal-20' }, true);
  render(React.createElement(AffiliateAccountPage, { apiClient: client }));

  await waitFor(() => {
    assert.ok(screen.getByLabelText('ID de Associado (termina com -20)'));
  });

  const input = screen.getByLabelText('ID de Associado (termina com -20)');

  // Tag sem terminação -20
  fireEvent.change(input, { target: { value: 'taginvalida' } });
  fireEvent.click(screen.getByText('Salvar tag da Amazon'));

  await waitFor(() => {
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(input.getAttribute('aria-describedby'), 'erro-tag-amazon');
    assert.ok(screen.getByText(/A tag da Amazon deve seguir o formato/));
  });

  // Tag válida mas API com erro
  fireEvent.change(input, { target: { value: 'novocanal-20' } });
  fireEvent.click(screen.getByText('Salvar tag da Amazon'));

  await waitFor(() => {
    assert.ok(screen.getByText('Confirmar e salvar'));
  });

  fireEvent.click(screen.getByText('Confirmar e salvar'));

  await waitFor(() => {
    const feedback = screen.getByRole('alert');
    assert.ok(feedback.textContent?.includes('Não foi possível salvar a tag da Amazon.'));
    assert.ok(!feedback.textContent?.includes('(HTTP'));
  });
});
