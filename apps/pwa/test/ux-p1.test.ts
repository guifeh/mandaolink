import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AffiliateAccountPage } from '../src/pages/AffiliateAccount.js';
import { NicheConfigPage } from '../src/pages/NicheConfig.js';
import { ScheduleLimitsPage } from '../src/pages/ScheduleLimits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('UX P1-1: viewport permite zoom e não bloqueia maximum-scale ou user-scalable', () => {
  const htmlPath = path.resolve(__dirname, '../index.html');
  const content = fs.readFileSync(htmlPath, 'utf-8');

  assert.ok(!content.includes('maximum-scale'), 'Viewport não deve restringir maximum-scale');
  assert.ok(!content.includes('user-scalable=no'), 'Viewport não deve bloquear user-scalable');
  assert.match(content, /<meta name="viewport" content="[^"]*width=device-width[^"]*"/);
});

test('UX P1-3: CSS define exclusivamente .feedback-sucesso e .feedback-erro em português', () => {
  const cssPath = path.resolve(__dirname, '../src/index.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  // Devem existir no CSS
  assert.ok(css.includes('.feedback-sucesso'), 'Classe .feedback-sucesso deve existir no CSS');
  assert.ok(css.includes('.feedback-erro'), 'Classe .feedback-erro deve existir no CSS');

  // Classes antigas em inglês não devem mais existir
  assert.ok(!css.includes('.feedback-success'), 'Classe legada .feedback-success deve ter sido removida do CSS');
  assert.ok(!css.includes('.feedback-error'), 'Classe legada .feedback-error deve ter sido removida do CSS');
});

test('UX P1-3: telas renderizam feedback com classes .feedback-sucesso e .feedback-erro e papéis de acessibilidade (role="status" e role="alert")', () => {
  // 1. Tela de Conta de Afiliado - Sucesso
  const htmlAfiliadoSucesso = renderToStaticMarkup(
    React.createElement(AffiliateAccountPage, {
      initialFeedback: { tipo: 'sucesso', texto: 'Tag salva com sucesso!' },
    }),
  );
  assert.match(
    htmlAfiliadoSucesso,
    /class="[^"]*feedback-msg[^"]*feedback-sucesso[^"]*"/,
    'Tela de Afiliado renderizada deve aplicar a classe .feedback-sucesso',
  );
  assert.match(
    htmlAfiliadoSucesso,
    /role="status"/,
    'Mensagem de sucesso deve ter role="status" para anúncio por leitores de tela',
  );

  // 2. Tela de Conta de Afiliado - Erro
  const htmlAfiliadoErro = renderToStaticMarkup(
    React.createElement(AffiliateAccountPage, {
      initialFeedback: { tipo: 'erro', texto: 'Formato de tag inválido.' },
    }),
  );
  assert.match(
    htmlAfiliadoErro,
    /class="[^"]*feedback-msg[^"]*feedback-erro[^"]*"/,
    'Tela de Afiliado renderizada deve aplicar a classe .feedback-erro',
  );
  assert.match(
    htmlAfiliadoErro,
    /role="alert"/,
    'Mensagem de erro deve ter role="alert" para anúncio imediato por leitores de tela',
  );

  // 3. Tela de Nicho - Sucesso e Erro
  const htmlNichoSucesso = renderToStaticMarkup(
    React.createElement(NicheConfigPage, {
      initialFeedback: { tipo: 'sucesso', texto: 'Nicho salvo com sucesso!' },
    }),
  );
  assert.ok(htmlNichoSucesso.includes('feedback-sucesso'));
  assert.ok(htmlNichoSucesso.includes('role="status"'));

  const htmlNichoErro = renderToStaticMarkup(
    React.createElement(NicheConfigPage, {
      initialFeedback: { tipo: 'erro', texto: 'Palavra duplicada.' },
    }),
  );
  assert.ok(htmlNichoErro.includes('feedback-erro'));
  assert.ok(htmlNichoErro.includes('role="alert"'));

  // 4. Tela de Horários e Limites - Sucesso e Erro
  const htmlHorariosSucesso = renderToStaticMarkup(
    React.createElement(ScheduleLimitsPage, {
      initialFeedback: { tipo: 'sucesso', texto: 'Horários atualizados!' },
    }),
  );
  assert.ok(htmlHorariosSucesso.includes('feedback-sucesso'));
  assert.ok(htmlHorariosSucesso.includes('role="status"'));

  const htmlHorariosErro = renderToStaticMarkup(
    React.createElement(ScheduleLimitsPage, {
      initialFeedback: { tipo: 'erro', texto: 'Início deve ser antes do fim.' },
    }),
  );
  assert.ok(htmlHorariosErro.includes('feedback-erro'));
  assert.ok(htmlHorariosErro.includes('role="alert"'));
});
