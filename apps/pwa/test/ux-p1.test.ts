import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Feedback } from '../src/components/Feedback.js';

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

test('UX P1-3: componente Feedback renderiza classes .feedback-sucesso e .feedback-erro e papéis de acessibilidade (role="status" e role="alert")', () => {
  // Sucesso
  const htmlSucesso = renderToStaticMarkup(
    React.createElement(Feedback, {
      msg: { tipo: 'sucesso', texto: 'Configurações salvas com sucesso!' },
    }),
  );
  assert.match(
    htmlSucesso,
    /class="[^"]*feedback-msg[^"]*feedback-sucesso[^"]*"/,
    'Mensagem de sucesso deve aplicar a classe .feedback-sucesso',
  );
  assert.match(
    htmlSucesso,
    /role="status"/,
    'Mensagem de sucesso deve ter role="status" para anúncio por leitores de tela',
  );
  assert.ok(htmlSucesso.includes('Configurações salvas com sucesso!'));

  // Erro
  const htmlErro = renderToStaticMarkup(
    React.createElement(Feedback, {
      msg: { tipo: 'erro', texto: 'Falha na validação dos dados.' },
    }),
  );
  assert.match(
    htmlErro,
    /class="[^"]*feedback-msg[^"]*feedback-erro[^"]*"/,
    'Mensagem de erro deve aplicar a classe .feedback-erro',
  );
  assert.match(
    htmlErro,
    /role="alert"/,
    'Mensagem de erro deve ter role="alert" para anúncio imediato por leitores de tela',
  );
  assert.ok(htmlErro.includes('Falha na validação dos dados.'));

  // Null não renderiza nada
  const htmlNull = renderToStaticMarkup(
    React.createElement(Feedback, {
      msg: null,
    }),
  );
  assert.equal(htmlNull, '', 'Feedback com msg null não deve renderizar nada');
});
