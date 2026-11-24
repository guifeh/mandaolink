import staticFiles from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
export async function servePwa(app: FastifyInstance) {
  await app.register(staticFiles, {
    root: fileURLToPath(new URL('../../pwa/dist/', import.meta.url)),
    wildcard: false,
  });
  app.get('/login', (_req, reply) => reply.sendFile('index.html'));
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && isPwaNavigation(req.url.split('?')[0], req.headers.accept)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ erro: 'rota nao encontrada' });
  });
}
export function isPwaNavigation(path: string, accept?: string) {
  return !!accept?.includes('text/html') && !path.split('/').pop()?.includes('.');
}
export function publicPwaPath(path: string) {
  return (
    [
      '/',
      '/index.html',
      '/login',
      '/sw.js',
      '/manifest.webmanifest',
      '/registerSW.js',
      '/icon-192.svg',
      '/icon-512.svg',
    ].includes(path) || /^\/assets\/[\w.-]+$/.test(path)
  );
}
