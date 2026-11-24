import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { isPwaNavigation } from './static.js';

export function destinationConflict(error: unknown) {
  return error instanceof Error && 'constraint' in error && error.constraint === 'destino_nao_fonte';
}

export function registerSources(app: FastifyInstance, db: Pool) {
  app.get('/fontes', { config: { pwaNavigation: true } }, async (req, reply) => {
    if (isPwaNavigation(req.url.split('?')[0], req.headers.accept) && app.hasReplyDecorator('sendFile')) {
      return reply.sendFile('index.html');
    }
    return {
      fontes: (
        await db.query(`SELECT f.*,m.ultima_mensagem_em,
        CASE WHEN EXISTS (SELECT 1 FROM excecoes e WHERE e.fonte_id=f.id AND e.resolvida_em IS NULL
          AND e.tipo IN ('fonte_perdida','whatsapp_removido_do_grupo')) THEN 'perdida'
          WHEN COALESCE(m.ultima_mensagem_em,f.criada_em) < now()-interval '24 hours' THEN 'quieta'
          ELSE 'ativa' END AS estado
        FROM fontes f LEFT JOIN LATERAL (
          SELECT recebida_em AS ultima_mensagem_em FROM mensagens_brutas
          WHERE fonte_id=f.id ORDER BY recebida_em DESC LIMIT 1
        ) m ON true
        WHERE f.plataforma <> 'whatsapp' OR f.identificador_externo IS DISTINCT FROM
          (SELECT destino_whatsapp_jid FROM config_nicho WHERE id=1)
        ORDER BY f.nome,f.id`)
      ).rows,
    };
  });
  app.put<{ Params: { id: string }; Body: { ativa: boolean } }>(
    '/fontes/:id',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['ativa'],
          properties: { ativa: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      try {
        const row = (
          await db.query(
            `WITH updated AS (UPDATE fontes SET ativa=$2,
        autorizada_em=CASE WHEN $2 THEN COALESCE(autorizada_em,now()) ELSE autorizada_em END
        WHERE id=$1 RETURNING *), resolved AS (
          UPDATE excecoes SET resolvida_em=now() WHERE resolvida_em IS NULL
          AND tipo IN ('fonte_perdida','whatsapp_removido_do_grupo')
          AND fonte_id IN (SELECT id FROM updated WHERE NOT ativa) RETURNING id
        ) SELECT * FROM updated`,
            [req.params.id, req.body.ativa],
          )
        ).rows[0];
        return row ?? reply.code(404).send({ erro: 'Fonte não encontrada.' });
      } catch (error) {
        if (destinationConflict(error))
          return reply.code(409).send({ erro: 'O grupo de destino não pode ser uma fonte.' });
        throw error;
      }
    },
  );
}
