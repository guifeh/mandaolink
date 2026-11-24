import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api/client.js';
import { loadSession } from './auth.js';
export function AuthGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    loadSession()
      .then((ok) => {
        if (alive) setAuthenticated(ok);
      })
      .catch((e) => {
        if (alive) {
          setAuthenticated(false);
          setMessage(e.message);
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  if (authenticated === null) return <p role="status">Verificando acesso…</p>;
  if (authenticated) return <>{children}</>;
  return (
    <main className="app-container">
      <section className="card">
        <h1 className="page-title">Entrar no MandaoLink</h1>
        <p>Use o e-mail do responsável pelo painel.</p>
        {message && <p role="status">{message}</p>}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              setMessage(await api.requestMagicLink(email));
            } catch (e) {
              setMessage(e instanceof Error ? e.message : 'Não foi possível solicitar acesso.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="form-label" htmlFor="login-email">
            E-mail
          </label>
          <input
            id="login-email"
            className="form-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
          />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Solicitando…' : 'Receber link de acesso'}
          </button>
        </form>
      </section>
    </main>
  );
}
