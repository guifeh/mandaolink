import pg from 'pg';

export function connectDatabase(connectionString: string) {
  return new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
}
