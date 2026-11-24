import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { connectDatabase } from './db.js';

export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(347891)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())',
    );
    const dir = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));
    for (const name of (await readdir(dir)).filter((n) => /^\d+.*\.sql$/.test(n)).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE nome=$1', [name])).rowCount) continue;
      const sql = await readFile(resolve(dir, name), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(nome) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(347891)');
    client.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatoria');
  const pool = connectDatabase(process.env.DATABASE_URL);
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
