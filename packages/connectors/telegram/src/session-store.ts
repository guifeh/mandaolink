// Sessão MTProto (StringSession) cifrada em disco com AES-256-GCM e gravação atômica.
// Chave: TG_SESSION_KEY no .env (32 bytes em base64 ou hex). Perder a chave = entrar de novo.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const AAD = Buffer.from('mandaolink-telegram-session-v1');

export function parseSessionKey(raw: string | undefined): Buffer {
  const v = (raw ?? '').trim();
  const key = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (key.length !== 32) throw new Error('TG_SESSION_KEY deve ter 32 bytes (base64 ou hex)');
  return key;
}

export async function saveSession(path: string, key: Buffer, session: string): Promise<void> {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(AAD);
  const data = Buffer.concat([c.update(session, 'utf8'), c.final()]);
  const payload = JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, payload, { mode: 0o600 });
  await rename(tmp, path);
}

/** null se o arquivo não existe. Chave errada ou arquivo adulterado: erro (não começa sessão nova em silêncio). */
export async function loadSession(path: string, key: Buffer): Promise<string | null> {
  let stored: string;
  try {
    stored = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  const { v, iv, tag, data } = JSON.parse(stored) as { v: number; iv: string; tag: string; data: string };
  if (v !== 1) throw new Error('formato de sessão desconhecido');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAAD(AAD);
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}
