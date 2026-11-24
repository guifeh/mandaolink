interface HeartbeatOptions {
  fetchImpl?: typeof fetch;
  check?: () => Promise<void>;
  onError?: () => void;
  schedule?: (tick: () => Promise<void>, ms: number) => () => void;
}
export function startHeartbeat(target: string, options: HeartbeatOptions = {}) {
  if (!target.trim()) return { stop() {} };
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HEARTBEAT_URL invalida');
  let busy = false, stopped = false;
  const abort = new AbortController();
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      await options.check?.();
      if (stopped) return;
      const response = await (options.fetchImpl ?? fetch)(url, { redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
      await response.body?.cancel();
      if (!response.ok) throw new Error('heartbeat indisponivel');
    } catch { if (!stopped) options.onError?.(); }
    finally { busy = false; }
  };
  const schedule = options.schedule ?? ((callback, ms) => {
    const timer = setInterval(() => { void callback(); }, ms); timer.unref(); return () => clearInterval(timer);
  });
  const cancel = schedule(tick, 5 * 60000);
  return { stop() { stopped = true; abort.abort(); cancel(); } };
}
