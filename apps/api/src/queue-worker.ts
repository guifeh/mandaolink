import type { PgBoss } from 'pg-boss';
import type { Pool } from 'pg';
import {
  dispatchNext,
  runBeforeSend,
  resolve,
  nicheGate,
  renderMessage,
  validateMessage,
  type ProductReader,
  type Publisher,
} from '@mandaolink/core';
import { createQueueStore } from './queue-store.js';
import { createPipelineStore } from './pipeline-store.js';

export type BossClient = Pick<PgBoss, 'start' | 'stop' | 'send' | 'work' | 'createQueue' | 'on' | 'off'>;
const queueName = 'mandaolink-dispatch';
export async function startQueueWorker(options: {
  boss: BossClient;
  db: Pool;
  reader: ProductReader;
  publisher: Publisher;
  onError(error: Error): void;
  now?: () => number;
  random?: () => number;
  simulated?: boolean;
}) {
  const { boss, db } = options;
  const now = options.now ?? Date.now;
  const store = createQueueStore(db, options.simulated);
  let stopping = false;
  const onError = (error: Error) => options.onError(error);
  boss.on('error', onError);
  const wake = () => boss.send(queueName, {}, { singletonKey: 'global', startAfter: new Date(now() + 1000) });
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await boss.start();
    await boss.createQueue(queueName, { policy: 'stately', retryLimit: 3, retryDelay: 5, expireInSeconds: 60 });
    await boss.work(queueName, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 1 }, async () => {
      await dispatchNext({
        store,
        publisher: options.publisher,
        now,
        random: options.random ?? Math.random,
        validate: (item) =>
          runBeforeSend(item, {
            ...createPipelineStore(db, item.destinoId),
            reader: options.reader,
            now,
            resolve,
            nicheGate,
            renderMessage,
            validateMessage,
          }),
      });
    });
    await wake();
    // Um job ativo ocupa singletonKey; agendar de fora evita perder o proximo tick.
    timer = setInterval(() => {
      if (!stopping) void wake().catch(onError);
    }, 1000);
    timer.unref();
  } catch (error) {
    stopping = true;
    try {
      await boss.stop();
    } finally {
      boss.off('error', onError);
    }
    throw error;
  }
  return {
    store,
    async stop() {
      stopping = true;
      clearInterval(timer);
      try {
        await boss.stop({ graceful: true, timeout: 60000 });
      } finally {
        boss.off('error', onError);
      }
    },
  };
}
