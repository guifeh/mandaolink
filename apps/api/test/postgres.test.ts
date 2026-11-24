// Migrações num Postgres real (o CI sobe um service container). Sem TEST_DATABASE_URL, é pulado.
// Complementa os testes em PGlite: valida TCP, advisory lock e o SQL no Postgres de verdade.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import pg from 'pg';
import { migrate } from '../src/migrate.js';

const url = process.env.TEST_DATABASE_URL;

test('migrações sobem do zero no Postgres real, são idempotentes e mantêm as regras', { skip: !url && 'TEST_DATABASE_URL ausente' }, async () => {
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
    await Promise.all([migrate(pool), migrate(pool)]); // concorrente: o advisory lock serializa

    const files = (await readdir(new URL('../../../db/migrations/', import.meta.url))).filter((n) => /^\d+.*\.sql$/.test(n));
    const applied = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    assert.equal(applied.rows[0].n, files.length);

    const tables = await pool.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables WHERE table_schema='public'`);
    for (const t of ['fontes', 'mensagens_brutas', 'ofertas', 'eventos_oferta', 'envios', 'config_nicho', 'excecoes']) {
      assert.ok(tables.rows.some((r) => r.t === t), `tabela ${t}`);
    }

    // Log imutável e fonte ativa só com autorização valem no Postgres real.
    const fonte = await pool.query<{ id: string }>(
      `INSERT INTO fontes(plataforma, identificador_externo, nome, ativa, autorizada_em) VALUES ('whatsapp','g1@g.us','Exemplo',true,now()) RETURNING id`,
    );
    await assert.rejects(pool.query(`INSERT INTO fontes(plataforma, identificador_externo, nome, ativa) VALUES ('whatsapp','g2@g.us','X',true)`));
    const msg = await pool.query<{ id: string }>(
      `INSERT INTO mensagens_brutas(fonte_id, mensagem_externa_id, conteudo, publicada_em) VALUES ($1,'m1','{"texto":"x"}',now()) RETURNING id`,
      [fonte.rows[0].id],
    );
    await assert.rejects(pool.query(`UPDATE mensagens_brutas SET mensagem_externa_id='m2' WHERE id=$1`, [msg.rows[0].id]), /imutavel/);
  } finally {
    await pool.end();
  }
});
