import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { buildApp } from '../src/app.js';
const db = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pool;
test('tunel confiavel usa CF-Connecting-IP para separar clientes do rate limit', async () => {
  const app = await buildApp({ db, ownerEmail: 'owner@example.test', appOrigin: 'https://painel.example.test', tunnelProxies: ['10.0.0.10/32'] });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await app.inject({ method: 'POST', url: '/auth/link', remoteAddress: '10.0.0.10', headers: { 'cf-connecting-ip': '203.0.113.1' }, payload: { email: 'other@example.test' } })).statusCode, 202);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/link', remoteAddress: '10.0.0.10', headers: { 'cf-connecting-ip': '203.0.113.1' }, payload: { email: 'other@example.test' } })).statusCode, 429);
    assert.equal((await app.inject({ method: 'POST', url: '/auth/link', remoteAddress: '10.0.0.10', headers: { 'cf-connecting-ip': '203.0.113.2' }, payload: { email: 'other@example.test' } })).statusCode, 202);
  } finally { await app.close(); }
});
test('acesso direto nao confia em CF-Connecting-IP nem X-Forwarded-For falsificados', async () => {
  const app = await buildApp({ db, ownerEmail: 'owner@example.test', appOrigin: 'https://painel.example.test', tunnelProxies: ['10.0.0.10/32'] });
  try {
    let status = 0;
    for (let i = 0; i < 6; i++) status = (await app.inject({ method: 'POST', url: '/auth/link', remoteAddress: '203.0.113.9', headers: { 'cf-connecting-ip': `203.0.113.${i + 10}`, 'x-forwarded-for': `198.51.100.${i}` }, payload: { email: 'other@example.test' } })).statusCode;
    assert.equal(status, 429);
  } finally { await app.close(); }
});
