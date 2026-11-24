import type { HistoryRow, OperationState } from '../operations-model.js';
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...options });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Faça login para abrir a operação.'
        : 'Não foi possível atualizar a operação. Tente novamente.',
    );
  return response.status === 204 ? (undefined as T) : response.json();
}
export const operations = {
  state: () => request<OperationState>('/operacao'),
  history: (page: number) =>
    request<{ pagina: number; mais: boolean; envios: HistoryRow[] }>(`/operacao/historico?pagina=${page}`),
  pair: () => request<{ simulado: boolean; codigo: string; qr: string; aviso: string }>('/pareamento'),
  pause: (pausado: boolean) =>
    request('/pausa', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pausado }),
    }),
  async enablePush() {
    if (
      !window.isSecureContext ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    )
      throw new Error('Notificações exigem navegador compatível e HTTPS. No iPhone, instale o painel na tela inicial.');
    if ((await Notification.requestPermission()) !== 'granted')
      throw new Error('As notificações não foram autorizadas neste navegador.');
    const { publicKey, simulado } = await request<{ publicKey: string; simulado: boolean }>('/push/config');
    const worker = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Abra a versão instalada do painel para ativar notificações.')), 10000),
      ),
    ]);
    const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const subscription =
      (await worker.pushManager.getSubscription()) ??
      (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    const json = subscription.toJSON();
    await request('/push/assinatura', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
    return simulado
      ? 'Inscrição salva. O modo ensaio não envia avisos externos.'
      : 'Notificações ativadas para novas pendências.';
  },
  async disablePush() {
    if (!('serviceWorker' in navigator)) return;
    const worker = await navigator.serviceWorker.getRegistration();
    const subscription = await worker?.pushManager.getSubscription();
    if (subscription) {
      await request('/push/assinatura', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
  },
};
