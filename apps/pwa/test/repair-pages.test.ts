import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SourcesPage } from '../src/pages/Sources.js';
import { HelpPage } from '../src/pages/Help.js';

test('paginas de conserto tem instrucoes, destinos das ancoras e retorno ao Inicio', () => {
  const sources = renderToStaticMarkup(createElement(SourcesPage));
  assert.match(sources, /A tela de fontes está em preparação/);
  assert.match(sources, /adicioná-lo de novo/);
  assert.match(sources, /href="\/"/);
  const help = renderToStaticMarkup(createElement(HelpPage));
  for (const anchor of ['numero-bloqueado', 'grupo-destino', 'falhas']) {
    assert.ok(help.includes(`id="${anchor}"`), anchor);
  }
  assert.match(help, /troque o chip/);
  assert.match(help, /href="\/"/);
});
