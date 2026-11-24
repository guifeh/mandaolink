import type { Pool } from 'pg';
import { loadReferenceFixtures, extractSourceUrls, resolve, type ProductSnapshot } from '@mandaolink/core';
import type { RuntimeConnectors } from './runtime.js';

export async function createFakeConnectors(db: Pool, now = Date.now): Promise<RuntimeConnectors> {
  const fixtures = await loadReferenceFixtures();
  const products = new Map<string, ProductSnapshot>();
  const redirects = new Map<string, string>();
  for (const fixture of fixtures) {
    const c = fixture.contexto;
    if (c?.asin) {
      products.set(c.asin, { asin: c.asin, pageAsin: c.asin, title: c.tituloOficial ?? null, priceCents: c.precoAtualCents ?? null,
        image: 'https://images.example.test/synthetic.jpg', available: c.disponivel ?? null, checkedAt: new Date(now()).toISOString(), category: c.categoria, cupom: c.cupom });
      for (const url of extractSourceUrls(fixture.mensagem.texto)) redirects.set(url, `https://www.amazon.com.br/dp/${c.asin}?tag=terceiro-20`);
    }
  }
  let stopped = false;
  return {
    source: {
      async start(accept) {
        for (const fixture of fixtures) {
          if (stopped) break;
          const source = fixture.mensagem.fonte;
          const row = (await db.query(`INSERT INTO fontes(plataforma,identificador_externo,nome,ativa,autorizada_em)
            VALUES ($1,$2,$3,true,$4) ON CONFLICT (plataforma,identificador_externo) DO UPDATE SET nome=excluded.nome RETURNING id`,
          [source.plataforma, `fake:${source.id}`, 'Fonte sintetica de ensaio', new Date(now())])).rows[0];
          await accept({ sourceId: row.id, externalId: `fixture:${fixture.id}`, text: fixture.mensagem.texto, link: fixture.mensagem.link,
            publishedAt: now(), advertisedPriceCents: fixture.contexto?.precoAnunciadoCents });
        }
      },
      async stop() { stopped = true; }
    },
    reader: {
      async read(asin) { const p = products.get(asin); return p ? { ok: true, product: { ...p, checkedAt: new Date(now()).toISOString() } } : { ok: false, reason: 'produto_inexistente' }; }
    },
    resolve: url => resolve(url, (async (target: string | URL | Request) => {
      const location = redirects.get(String(target));
      return new Response(null, { status: location ? 302 : 404, headers: location ? { location } : {} });
    }) as typeof fetch),
    publisher: { async send(message) { return { status: 'enviado', mensagemId: `fake:${message.idempotencyKey}`, simulado: true }; } }
  };
}
