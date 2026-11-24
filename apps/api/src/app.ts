import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import proxyaddr from '@fastify/proxy-addr';
import { isIP } from 'node:net';
import { buildDailySummary } from '@mandaolink/core';
import { registerOperations } from './operations.js';
import { createPushService } from './push.js';
import { publicPwaPath } from './static.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('hex');
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const words = {
  type: 'array',
  maxItems: 100,
  items: { type: 'string', minLength: 1, maxLength: 100 },
  uniqueItems: true,
};
const configProperties = {
  nome: { type: 'string', minLength: 1, maxLength: 100 },
  palavras_chave: words,
  palavras_bloqueadas: words,
  categorias: words,
  tag_amazon: { type: 'string', maxLength: 35, pattern: '^([a-z0-9][a-z0-9-]{1,30}-20)?$' },
  limite_hora: { type: 'integer', minimum: 1, maximum: 100 },
  limite_dia: { type: 'integer', minimum: 1, maximum: 1000 },
  horario_inicio: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  horario_fim: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
};
export interface NicheConfig {
  nome: string;
  palavras_chave: string[];
  palavras_bloqueadas: string[];
  categorias: string[];
  tag_amazon: string;
  limite_hora: number;
  limite_dia: number;
  horario_inicio: string;
  horario_fim: string;
}
export interface AppOptions {
  db: Pool;
  ownerEmail: string;
  appOrigin: string;
  cookieSecure?: boolean;
  sendMagicLink?: (email: string, link: string) => Promise<void>;
  tunnelProxies?: string[];
  fakePairing?: boolean;
  push?: ReturnType<typeof createPushService>;
}

export async function buildApp(options: AppOptions) {
  if (!options.ownerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.ownerEmail))
    throw new Error('OWNER_EMAIL invalido');
  const origin = new URL(options.appOrigin).origin;
  const db = options.db;
  const trusted = options.tunnelProxies?.length ? proxyaddr.compile(options.tunnelProxies) : () => false;
  const app = Fastify({ trustProxy: trusted, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => {
      const peer = request.raw.socket.remoteAddress ?? '';
      const cf = request.headers['cf-connecting-ip'];
      return trusted(peer, 0) && typeof cf === 'string' && isIP(cf) ? cf : peer;
    },
  });
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== origin) {
      return reply.code(403).send({ erro: 'origem nao permitida' });
    }
    if (
      req.url.split('?')[0] === '/saude' ||
      req.url.startsWith('/auth/') ||
      (req.method === 'GET' && publicPwaPath(req.url.split('?')[0]))
    )
      return;
    const session = req.cookies.sessao;
    if (
      !session ||
      !/^[a-f0-9]{64}$/.test(session) ||
      !(await db.query('SELECT 1 FROM auth_sessoes WHERE token_hash=$1 AND expira_em > now()', [hash(session)]))
        .rowCount
    ) {
      return reply.code(401).send({ erro: 'autenticacao necessaria' });
    }
  });
  app.setErrorHandler<FastifyError>((error, _req, reply) => {
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    reply.code(status).send({ erro: status === 500 ? 'erro interno' : error.message });
  });

  app.get('/saude', async (_req, reply) => {
    try {
      await db.query('SELECT 1');
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'indisponivel' });
    }
  });
  app.post<{ Body: { email: string } }>(
    '/auth/link',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: { body: object({ email: { type: 'string', format: 'email', maxLength: 254 } }) },
    },
    async (req, reply) => {
      if (req.body.email.toLowerCase() === options.ownerEmail.toLowerCase()) {
        const raw = token();
        // Nunca expor o token na API ou nos logs.
        await db.query('DELETE FROM auth_links WHERE expira_em <= now()');
        await db.query("INSERT INTO auth_links(token_hash, expira_em) VALUES ($1, now() + interval '15 minutes')", [
          hash(raw),
        ]);
        await options.sendMagicLink?.(options.ownerEmail, `${origin}/login#token=${raw}`);
      }
      return reply.code(202).send({ mensagem: 'Se o e-mail for autorizado, voce recebera um link.' });
    },
  );
  app.post<{ Body: { token: string } }>(
    '/auth/verificar',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { body: object({ token: { type: 'string', pattern: '^[a-f0-9]{64}$' } }) },
    },
    async (req, reply) => {
      const client = await db.connect();
      const raw = token();
      try {
        await client.query('BEGIN');
        const result = await client.query(
          'DELETE FROM auth_links WHERE token_hash=$1 AND expira_em > now() RETURNING token_hash',
          [hash(req.body.token)],
        );
        if (!result.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(401).send({ erro: 'link invalido ou expirado' });
        }
        await client.query("INSERT INTO auth_sessoes(token_hash, expira_em) VALUES ($1, now() + interval '30 days')", [
          hash(raw),
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      reply.setCookie('sessao', raw, {
        httpOnly: true,
        sameSite: 'strict',
        secure: options.cookieSecure ?? true,
        path: '/',
        maxAge: 30 * 86400,
      });
      return { autenticado: true };
    },
  );
  app.post('/auth/sair', async (req, reply) => {
    if (req.cookies.sessao) await db.query('DELETE FROM auth_sessoes WHERE token_hash=$1', [hash(req.cookies.sessao)]);
    reply.clearCookie('sessao', { path: '/' });
    return reply.code(204).send();
  });
  app.get('/config', async () => (await db.query('SELECT * FROM config_nicho WHERE id=1')).rows[0]);
  app.put<{ Body: NicheConfig }>('/config', { schema: { body: object(configProperties) } }, async (req, reply) => {
    const b = req.body;
    if (b.limite_hora > b.limite_dia || b.horario_inicio >= b.horario_fim)
      return reply.code(400).send({ erro: 'limites ou horarios invalidos' });
    return (
      await db.query(
        `UPDATE config_nicho SET nome=$1, palavras_chave=$2, palavras_bloqueadas=$3,
      categorias=$4, tag_amazon=$5, limite_hora=$6, limite_dia=$7, horario_inicio=$8, horario_fim=$9, atualizado_em=now()
      WHERE id=1 RETURNING *`,
        [
          b.nome,
          b.palavras_chave,
          b.palavras_bloqueadas,
          b.categorias,
          b.tag_amazon,
          b.limite_hora,
          b.limite_dia,
          b.horario_inicio,
          b.horario_fim,
        ],
      )
    ).rows[0];
  });
  app.put<{ Body: { pausado: boolean } }>(
    '/pausa',
    { schema: { body: object({ pausado: { type: 'boolean' } }) } },
    async (req) => {
      return (
        await db.query(
          'UPDATE config_nicho SET pausado=$1, atualizado_em=now() WHERE id=1 RETURNING pausado, atualizado_em',
          [req.body.pausado],
        )
      ).rows[0];
    },
  );
  app.get('/pendencias', async () => ({
    excecoes: (await db.query('SELECT * FROM excecoes WHERE resolvida_em IS NULL ORDER BY criada_em DESC LIMIT 100'))
      .rows,
    envios: (
      await db.query(
        "SELECT id, oferta_id, estado, erro, criado_em, incerto_em FROM envios WHERE estado IN ('falhou','incerto') ORDER BY criado_em DESC LIMIT 100",
      )
    ).rows,
  }));
  app.get<{ Querystring: { limite?: string; pagina?: string } }>(
    '/historico',
    {
      schema: {
        querystring: object(
          {
            limite: { type: 'string', pattern: '^([1-9]|[1-9][0-9]|100)$' },
            pagina: { type: 'string', pattern: '^[1-9][0-9]{0,4}$' },
          },
          [],
        ),
      },
    },
    async (req) => {
      const limit = Number(req.query.limite ?? 20),
        page = Number(req.query.pagina ?? 1);
      const values = [limit, (page - 1) * limit];
      return {
        pagina: page,
        limite: limit,
        eventos: (
          await db.query('SELECT * FROM eventos_oferta ORDER BY criado_em DESC, id DESC LIMIT $1 OFFSET $2', values)
        ).rows,
        envios: (await db.query('SELECT * FROM envios ORDER BY criado_em DESC, id DESC LIMIT $1 OFFSET $2', values))
          .rows,
      };
    },
  );
  app.get<{ Querystring: { data?: string } }>(
    '/resumo',
    {
      schema: { querystring: object({ data: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, []) },
    },
    async (req) => {
      const dataStr =
        req.query.data ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

      const enviadasRes = await db.query(
        `SELECT COUNT(*)::int as qtd FROM envios
       WHERE estado = 'enviado' AND (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $1::date`,
        [dataStr],
      );
      const enviadas = enviadasRes.rows[0]?.qtd ?? 0;

      const descartesRes = await db.query(
        `WITH motivos_unificados AS (
         SELECT motivo
         FROM eventos_oferta
         WHERE (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
           AND resultado = 'REPROVA'
           AND motivo IS NOT NULL
         UNION ALL
         SELECT motivo_descarte as motivo
         FROM envios
         WHERE (criado_em AT TIME ZONE 'America/Sao_Paulo')::date = $1::date
           AND estado = 'descartado'
           AND motivo_descarte IS NOT NULL
       )
       SELECT motivo, COUNT(*)::int as qtd
       FROM motivos_unificados
       GROUP BY motivo
       ORDER BY qtd DESC`,
        [dataStr],
      );

      const descartadas = descartesRes.rows.reduce((acc: number, r: { qtd: number }) => acc + Number(r.qtd), 0);
      const motivosPrincipais = descartesRes.rows.slice(0, 3).map((r: { motivo: string; qtd: number }) => ({
        motivo: r.motivo,
        quantidade: Number(r.qtd),
      }));

      const pendenciasRes = await db.query(`SELECT COUNT(*)::int as qtd FROM excecoes WHERE resolvida_em IS NULL`);
      const pendenciasAbertas = pendenciasRes.rows[0]?.qtd ?? 0;

      const configRes = await db.query('SELECT pausado FROM config_nicho WHERE id = 1');
      const pausado = configRes.rows[0]?.pausado ?? false;

      const dados = {
        enviadas,
        descartadas,
        motivosPrincipais,
        tempoParadoMinutos: pausado ? 60 : 0,
        pendenciasAbertas,
      };

      const texto = buildDailySummary(dados, dataStr);

      return {
        data: dataStr,
        texto,
        dados,
      };
    },
  );
  registerOperations(
    app,
    db,
    options.push ?? createPushService(db, `mailto:${options.ownerEmail}`),
    options.fakePairing ?? true,
  );
  return app;
}
