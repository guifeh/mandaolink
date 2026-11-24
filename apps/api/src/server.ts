import { PgBoss } from 'pg-boss';
import { connectDatabase } from './db.js';
import { migrate } from './migrate.js';
import { createFakeConnectors } from './fake-connectors.js';
import { runtimeFlags, startRuntime } from './runtime.js';
import { servePwa } from './static.js';

const flags = runtimeFlags(process.env);
if (!process.env.DATABASE_URL || !process.env.OWNER_EMAIL || !process.env.APP_ORIGIN) throw new Error('DATABASE_URL, OWNER_EMAIL e APP_ORIGIN obrigatorios');
// O adapter real S2/S3 sera ligado aqui quando entregue, sem inicializacao implicita.
if (flags.mode === 'real') throw new Error('Adapter real ainda nao registrado; use CONNECTORS=fake');
const db = connectDatabase(process.env.DATABASE_URL);
try {
  await migrate(db);
  const runtime = await startRuntime({ db, boss: new PgBoss(process.env.DATABASE_URL), connectors: await createFakeConnectors(db), dryRun: flags.dryRun,
    destination: 'fake:destino', ownerEmail: process.env.OWNER_EMAIL, appOrigin: process.env.APP_ORIGIN, cookieSecure: process.env.COOKIE_SECURE !== 'false',
    tunnelProxies: (process.env.TRUSTED_TUNNEL_PROXIES ?? '').split(',').map(s => s.trim()).filter(Boolean), heartbeatUrl: process.env.HEARTBEAT_URL });
  runtime.app.addHook('onClose', async () => { await db.end(); });
  await servePwa(runtime.app);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void runtime.stop().catch(() => { process.exitCode = 1; }); });
  try { await runtime.app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 3000) }); }
  catch (error) { await runtime.stop(); throw error; }
} catch (error) { await db.end(); throw error; }
