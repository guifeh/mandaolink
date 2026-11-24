import type { Pool } from 'pg';
import type { GateEvent, PipelineConfig } from '@mandaolink/core';

export async function loadLastSend(db: Pick<Pool, 'query'>, destination: string, asin: string) {
      const row = (await db.query(`SELECT e.enviado_em, e.preco_centavos FROM envios e JOIN ofertas o ON o.id=e.oferta_id
        WHERE o.loja='amazon' AND o.id_loja=$1 AND e.destino_id=$2 AND e.estado='enviado'
        ORDER BY enviado_em DESC LIMIT 1`, [asin, destination])).rows[0];
      return row ? { enviadoEm: new Date(row.enviado_em).getTime(), precoCentavos: row.preco_centavos === null ? null : Number(row.preco_centavos) } : null;
}
export function createPipelineStore(db: Pool, destination: string) {
  return {
    lastSend: (asin: string) => loadLastSend(db, destination, asin),
    async record(event: GateEvent) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        let offerId: string | null = null;
        if (event.asin) {
          offerId = (await client.query(`INSERT INTO ofertas(loja,id_loja) VALUES ('amazon',$1)
            ON CONFLICT (loja,id_loja) DO UPDATE SET id_loja=excluded.id_loja RETURNING id`, [event.asin])).rows[0].id;
          if (event.produto && event.resultado.status === 'PASSA') {
            const p = event.produto;
            await client.query(`UPDATE ofertas SET titulo=$2,preco_centavos=$3,imagem_url=$4,disponivel=$5,verificada_em=$6 WHERE id=$1`,
              [offerId, p.title, p.priceCents, p.image, p.available, p.checkedAt]);
          }
        }
        const r = event.resultado;
        await client.query(`INSERT INTO eventos_oferta(oferta_id,mensagem_bruta_id,gate,resultado,motivo,tentar_em,criado_em)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [offerId, event.mensagemId, event.gate, r.status, r.status === 'PASSA' ? null : r.motivo,
          r.status === 'ADIA' ? new Date(r.quando) : null, new Date(event.criadoEm)]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
  };
}
export async function loadPipelineConfig(db: Pick<Pool, 'query'>): Promise<PipelineConfig> {
  const c = (await db.query('SELECT * FROM config_nicho WHERE id=1')).rows[0];
  if (!c) throw new Error('configuracao ausente');
  const sources = (await db.query('SELECT id FROM fontes WHERE ativa AND autorizada_em IS NOT NULL')).rows;
  return { fontesPermitidas: sources.map(s => s.id), tagAmazon: c.tag_amazon,
    nicho: { nome: c.nome, palavras_chave: c.palavras_chave, palavras_bloqueadas: c.palavras_bloqueadas, categorias: c.categorias } };
}
