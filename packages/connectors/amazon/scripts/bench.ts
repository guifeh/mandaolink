// Benchmark da S1.
//   node scripts/bench.ts sample <fetch|browser> [n=30]          → amostra: sucesso, tempo, motivos
//   node scripts/bench.ts rate <fetch|browser> <minutos> <gapMs>  → ritmo fixo até o tempo acabar ou o 1º bloqueio
// Lê fixtures/asins-carro.txt e grava reports/<modo>-<via>-<data>.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createAmazonReader, createBrowserReader, createFetchReader, type ReadResult } from '../src/index.ts';
import { BLOCK_COOLDOWN_MS, createPacedReader } from '../src/reader.ts';

const [mode = 'sample', via = 'fetch', a3, a4] = process.argv.slice(2);
const asins = readFileSync('fixtures/asins-carro.txt', 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => l.split('\t')[0].replace(/^﻿/, ''));

// via: fetch | browser | auto (fetch com fallback para navegador, como no pipeline)
const browserReader = () => createBrowserReader({ userDataDir: '.profile-amazon' });
const base = via === 'browser' ? browserReader() : createFetchReader();
const fallback = via === 'auto' ? browserReader() : undefined;

/** Publicável = leu e tem tudo que a mensagem precisa. */
function classify(r: ReadResult): string {
  if (!r.ok) return r.reason;
  const p = r.product;
  if (!p.title) return 'sem_titulo';
  if (p.available === false) return 'indisponivel';
  if (p.priceCents === null) return 'sem_preco';
  if (!p.image) return 'sem_foto';
  if (p.pageAsin && p.pageAsin !== p.asin) return 'outra_variacao';
  return 'ok';
}

const rows: Record<string, unknown>[] = [];
const t0 = Date.now();
let stop = '';

if (mode === 'sample') {
  const n = Number(a3 ?? 30);
  const reader = createAmazonReader({ primary: base, fallback });
  for (const asin of asins.slice(0, n)) {
    const r = await reader.read(asin);
    rows.push({ asin, result: classify(r), ms: r.ms, via: r.via, product: r.ok ? r.product : undefined });
    console.error(asin, classify(r), `${r.ms}ms`);
    if (classify(r) === 'em_pausa_por_bloqueio') {
      stop = 'pausa por bloqueio';
      break;
    }
  }
  await reader.close();
} else {
  const minutes = Number(a3 ?? 10);
  const gap = Number(a4 ?? 3000);
  // Benchmark de taxa: ritmo livre de propósito (o leitor de produção tem piso fixo).
  const reader = createPacedReader({ primary: base, minGapMs: gap, maxGapMs: gap, cooldownMs: BLOCK_COOLDOWN_MS });
  const end = t0 + minutes * 60_000;
  for (let i = 0; Date.now() < end; i++) {
    const asin = asins[i % asins.length];
    const r = await reader.read(asin);
    const c = classify(r);
    rows.push({ i, asin, result: c, ms: r.ms, at: new Date().toISOString() });
    if (i % 20 === 0) console.error(i, c, `${r.ms}ms`);
    if (c.startsWith('bloqueado_') || c === 'em_pausa_por_bloqueio') {
      stop = `bloqueio na leitura ${i + 1}: ${c}`;
      break;
    }
  }
  await reader.close();
}

const elapsedMs = Date.now() - t0;
const reasons: Record<string, number> = {};
for (const r of rows) reasons[String(r.result)] = (reasons[String(r.result)] ?? 0) + 1;
const read = rows.filter((r) => !/^(bloqueado|rede|em_pausa)/.test(String(r.result)));
const times = rows.map((r) => Number(r.ms)).sort((a, b) => a - b);
const summary = {
  mode,
  via,
  at: new Date(t0).toISOString(),
  total: rows.length,
  publicavel: reasons.ok ?? 0,
  taxaPublicavel: rows.length ? +(((reasons.ok ?? 0) / rows.length) * 100).toFixed(1) : 0,
  taxaLeitura: rows.length ? +((read.length / rows.length) * 100).toFixed(1) : 0,
  msMedio: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
  msP95: times[Math.floor(times.length * 0.95)] ?? 0,
  leiturasPorHoraObservado: Math.round((rows.length / elapsedMs) * 3_600_000),
  duracaoMin: +(elapsedMs / 60_000).toFixed(1),
  motivos: reasons,
  cupom: (() => {
    const lidos = rows
      .map((r) => (r.product as { cupom?: { presente: boolean; legivel: boolean } } | undefined)?.cupom)
      .filter(Boolean);
    return {
      lidos: lidos.length,
      comCupom: lidos.filter((c) => c!.presente).length,
      ilegiveis: lidos.filter((c) => c!.presente && !c!.legivel).length,
    };
  })(),
  parada: stop || 'fim do tempo/amostra, sem bloqueio',
};
mkdirSync('reports', { recursive: true });
const out = `reports/${mode}-${via}-${new Date(t0).toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
console.log(JSON.stringify({ ...summary, report: out }, null, 2));
