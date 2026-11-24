import * as webpush from 'web-push';
import type { PushSubscription } from 'web-push';
import type { Pool } from 'pg';

export function validSubscription(value: PushSubscription): boolean {
  try {
    const url = new URL(value.endpoint);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname) &&
      /^[-_A-Za-z0-9]{87}$/.test(value.keys.p256dh) &&
      /^[-_A-Za-z0-9]{22}$/.test(value.keys.auth)
    );
  } catch {
    return false;
  }
}
export function createPushService(db: Pool, subject: string, dryRun = true, send = webpush.sendNotification) {
  const keys = async () => {
    let row = (await db.query('SELECT public_key,private_key FROM push_config WHERE id=1')).rows[0];
    if (!row) {
      const generated = webpush.generateVAPIDKeys();
      await db.query('INSERT INTO push_config(id,public_key,private_key) VALUES (1,$1,$2) ON CONFLICT DO NOTHING', [
        generated.publicKey,
        generated.privateKey,
      ]);
      row = (await db.query('SELECT public_key,private_key FROM push_config WHERE id=1')).rows[0];
    }
    return row;
  };
  return {
    async config() {
      return { publicKey: (await keys()).public_key, simulado: dryRun };
    },
    async subscribe(subscription: PushSubscription) {
      if (!validSubscription(subscription)) throw new Error('assinatura push invalida');
      await db.query(
        'INSERT INTO push_subscriptions(endpoint,subscription) VALUES ($1,$2) ON CONFLICT (endpoint) DO UPDATE SET subscription=excluded.subscription',
        [subscription.endpoint, JSON.stringify(subscription)],
      );
    },
    async unsubscribe(endpoint: string) {
      await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
    },
    async notify() {
      if (dryRun) return;
      const pending = (
        await db.query(`SELECT s.endpoint,s.subscription,e.id FROM push_subscriptions s CROSS JOIN excecoes e
        WHERE e.resolvida_em IS NULL AND e.criada_em >= s.criada_em AND NOT EXISTS
        (SELECT 1 FROM push_entregas p WHERE p.endpoint=s.endpoint AND p.excecao_id=e.id) ORDER BY e.criada_em LIMIT 20`)
      ).rows;
      if (!pending.length) return;
      const vapid = await keys();
      for (const row of pending) {
        if (!validSubscription(row.subscription)) continue;
        try {
          await send(
            row.subscription,
            JSON.stringify({
              title: 'MandaoLink precisa de atenção',
              body: 'Abra o painel para conferir uma pendência.',
              url: '/#operacao',
            }),
            {
              vapidDetails: { subject, publicKey: vapid.public_key, privateKey: vapid.private_key },
              TTL: 300,
              timeout: 10000,
            },
          );
          await db.query('INSERT INTO push_entregas(endpoint,excecao_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
            row.endpoint,
            row.id,
          ]);
        } catch (error) {
          if ([404, 410].includes(Number((error as { statusCode?: number }).statusCode)))
            await db.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [row.endpoint]);
          else throw new Error('notificacao push indisponivel');
        }
      }
    },
  };
}
