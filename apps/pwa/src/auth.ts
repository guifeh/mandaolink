let sessionRequest: Promise<boolean> | undefined;
export function loadSession() {
  return sessionRequest ??= (async () => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    if (token) {
      window.history.replaceState(null, '', '/#operacao');
      if (!/^[a-f0-9]{64}$/.test(token)) return false;
      const verified = await fetch('/auth/verificar', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      if (!verified.ok) throw new Error('O link expirou ou já foi usado. Peça outro link.');
    }
    const response = await fetch('/config', { credentials: 'include' });
    if (response.status === 401) return false;
    if (!response.ok) throw new Error('O painel está indisponível. Recarregue e tente novamente.');
    return true;
  })();
}
