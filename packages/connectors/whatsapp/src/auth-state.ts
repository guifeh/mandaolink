// Auth state do Baileys em disco, cifrado (AES-256-GCM). Mesmo layout do useMultiFileAuthState,
// com duas diferenças: cada arquivo é cifrado com a chave do .env (WA_AUTH_KEY) e a gravação é
// atômica (arquivo temporário + rename), para queda de energia não corromper a sessão.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BufferJSON, initAuthCreds, proto } from 'baileys';
import type { AuthBundle } from './types.ts';

/** Aceita 32 bytes em base64 (44 chars) ou hex (64 chars). Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" */
export function parseAuthKey(raw: string | undefined): Buffer {
  const v = (raw ?? '').trim();
  const key = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  if (key.length !== 32) throw new Error('WA_AUTH_KEY deve ter 32 bytes (base64 ou hex)');
  return key;
}

export function encrypt(key: Buffer, name: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(name)); // amarra o conteúdo ao nome do arquivo: trocar arquivos falha
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

export function decrypt(key: Buffer, name: string, stored: string): string {
  const { v, iv, tag, data } = JSON.parse(stored);
  if (v !== 1) throw new Error('formato de auth desconhecido');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(name));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

export async function useEncryptedFileAuthState(folder: string, key: Buffer): Promise<AuthBundle> {
  await mkdir(folder, { recursive: true });
  const locks = new Map<string, Promise<unknown>>();
  const fileName = (f: string) => `${f.replace(/\//g, '__').replace(/:/g, '-')}.enc`;
  const locked = <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const p = (locks.get(name) ?? Promise.resolve()).then(work, work);
    locks.set(name, p.catch(() => {}));
    return p;
  };

  const write = (data: unknown, file: string) => {
    const name = fileName(file);
    return locked(name, async () => {
      const tmp = join(folder, `${name}.${randomBytes(4).toString('hex')}.tmp`);
      await writeFile(tmp, encrypt(key, name, JSON.stringify(data, BufferJSON.replacer)));
      await rename(tmp, join(folder, name));
    });
  };
  const read = (file: string) => {
    const name = fileName(file);
    return locked(name, async () => {
      let stored: string;
      try {
        stored = await readFile(join(folder, name), 'utf8');
      } catch {
        return null; // arquivo ausente
      }
      // Chave errada ou arquivo adulterado: falha alto, não recomeça uma sessão nova em silêncio.
      return JSON.parse(decrypt(key, name, stored), BufferJSON.reviver);
    });
  };
  const remove = (file: string) => {
    const name = fileName(file);
    return locked(name, () => unlink(join(folder, name)).catch(() => {}));
  };

  const creds = (await read('creds.json')) ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const out: Record<string, unknown> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read(`${type}-${id}.json`);
              if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
              out[id] = value;
            }),
          );
          return out;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          const tasks: Promise<unknown>[] = [];
          for (const category in data)
            for (const id in data[category]) {
              const value = data[category][id];
              tasks.push(value ? write(value, `${category}-${id}.json`) : remove(`${category}-${id}.json`));
            }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write(creds, 'creds.json'),
  };
}
