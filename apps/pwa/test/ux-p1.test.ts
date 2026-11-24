import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('UX P1-1: viewport permite zoom e não bloqueia maximum-scale ou user-scalable', () => {
  const htmlPath = path.resolve(__dirname, '../index.html');
  const content = fs.readFileSync(htmlPath, 'utf-8');

  assert.ok(!content.includes('maximum-scale'), 'Viewport não deve restringir maximum-scale');
  assert.ok(!content.includes('user-scalable=no'), 'Viewport não deve bloquear user-scalable');
  assert.match(content, /<meta name="viewport" content="[^"]*width=device-width[^"]*"/);
});

test('UX P1-3: classes de feedback geradas pelos componentes existem no CSS', () => {
  const cssPath = path.resolve(__dirname, '../src/index.css');
  const css = fs.readFileSync(cssPath, 'utf-8');

  // NicheConfig, ScheduleLimits e AffiliateAccount geram feedback-${feedback.tipo} ('sucesso' | 'erro')
  assert.ok(
    css.includes('.feedback-sucesso'),
    'Classe .feedback-sucesso deve existir no CSS para estilizar feedback positivo',
  );
  assert.ok(
    css.includes('.feedback-erro'),
    'Classe .feedback-erro deve existir no CSS para estilizar feedback de erro',
  );
});
