import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import QRCode from 'qrcode';
import { createPushService } from './push.js';
import { traduzirMotivo } from '@mandaolink/core';

export function registerOperations(app: FastifyInstance, db: Pool, push: ReturnType<typeof createPushService>, fakePairing: boolean) {
  app.get('/operacao', async () => {
    const config = (await db.query('SELECT pausado FROM config_nicho WHERE id=1')).rows[0];
    const exceptions = (await db.query('SELECT * FROM excecoes WHERE resolvida_em IS NULL ORDER BY criada_em DESC LIMIT 100')).rows;
    const uncertain = (await db.query("SELECT count(*)::int AS n FROM envios WHERE estado IN ('incerto','falhou')")).rows[0].n;
    return { pausado: config.pausado, semaforo: config.pausado || exceptions.some(e => e.severidade === 'vermelho') ? 'vermelho' : exceptions.length || uncertain ? 'amarelo' : 'verde',
      excecoes: exceptions, enviosPendentes: uncertain };
  });
  app.get<{ Querystring: { pagina?: string } }>('/operacao/historico', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { pagina: { type: 'string', pattern: '^[1-9][0-9]{0,4}$' } } } }
  }, async request => {
    const page = Number(request.query.pagina ?? 1);
    const rows = (await db.query(`SELECT * FROM (
      SELECT e.id::text,e.estado,e.simulado,e.criado_em,e.enviado_em,e.motivo_descarte,o.titulo,o.id_loja
      FROM envios e JOIN ofertas o ON o.id=e.oferta_id WHERE e.estado IN ('enviado','descartado')
      UNION ALL
      SELECT 'evento:'||r.id,'descartado',r.simulado,r.criado_em,NULL,r.motivo,o.titulo,COALESCE(o.id_loja,'Produto nao identificado')
      FROM (SELECT DISTINCT ON (v.mensagem_bruta_id) v.* FROM eventos_oferta v
        WHERE v.resultado='REPROVA' AND NOT EXISTS (SELECT 1 FROM envios e WHERE e.mensagem_bruta_id=v.mensagem_bruta_id)
        ORDER BY v.mensagem_bruta_id,v.criado_em DESC,v.id DESC) r LEFT JOIN ofertas o ON o.id=r.oferta_id
      ) history ORDER BY criado_em DESC,id DESC LIMIT 21 OFFSET $1`, [(page - 1) * 20])).rows;
    return { pagina: page, mais: rows.length > 20, envios: rows.slice(0, 20).map(row => ({ ...row, motivo_legivel: row.estado === 'descartado' ? traduzirMotivo(row.motivo_descarte) : null })) };
  });
  app.get('/pareamento', async (_req, reply) => {
    if (!fakePairing) return reply.code(503).send({ erro: 'Pareamento real ainda indisponivel' });
    return { simulado: true, status: 'aguardando_pareamento', codigo: 'DEMO-1234', qr: await QRCode.toDataURL('MANDaoLINK:SIMULACAO:SEM-CONEXAO'), aviso: 'Exemplo de pareamento. Este código não conecta uma conta.' };
  });
  app.get('/push/config', () => push.config());
  app.post<{ Body: { endpoint: string; keys: { auth: string; p256dh: string } } }>('/push/assinatura', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['endpoint','keys'], properties: {
      endpoint: { type: 'string', maxLength: 2048 }, keys: { type: 'object', additionalProperties: false, required: ['auth','p256dh'], properties: {
        auth: { type: 'string', pattern: '^[-_A-Za-z0-9]{22}$' }, p256dh: { type: 'string', pattern: '^[-_A-Za-z0-9]{87}$' }
      } }
    } } }
  }, async (req, reply) => {
    try { await push.subscribe(req.body); } catch { return reply.code(400).send({ erro: 'assinatura push invalida' }); }
    return reply.code(204).send();
  });
  app.delete<{ Body: { endpoint: string } }>('/push/assinatura', { schema: { body: { type: 'object', additionalProperties: false, required: ['endpoint'], properties: { endpoint: { type: 'string', maxLength: 2048 } } } } }, async (req, reply) => {
    await push.unsubscribe(req.body.endpoint); return reply.code(204).send();
  });
}
