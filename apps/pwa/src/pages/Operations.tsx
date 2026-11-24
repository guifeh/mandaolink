import { useEffect, useState } from 'react';
import { operations } from '../api/operations.js';
import {
  statusText,
  repairLink,
  type OperationState,
  type HistoryRow,
  type PendingState,
} from '../operations-model.js';

export function OperationsPage() {
  const [state, setState] = useState<OperationState | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [page, setPage] = useState(1),
    [more, setMore] = useState(false);
  const [pair, setPair] = useState<Awaited<ReturnType<typeof operations.pair>> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true;
    setError('');
    Promise.all([operations.state(), operations.history(page), operations.pending()])
      .then(([status, past, pendencias]) => {
        if (alive) {
          setState(status);
          setHistory(past.envios);
          setMore(past.mais);
          setPending(pendencias);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [page]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao executar. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <h1 className="page-title">Início</h1>
      {error && (
        <p className="feedback-msg feedback-erro" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!state ? (
        <p role="status">{error ? 'Dados indisponíveis.' : 'Carregando operação…'}</p>
      ) : (
        <>
          <section
            className={`operation-status operation-status-${state.pausado ? 'pausado' : state.semaforo}`}
            aria-label="Status da operação"
          >
            <h2 className="operation-status-title" role="status">
              {state.pausado ? 'Todos os envios estão pausados' : statusText[state.semaforo]}
            </h2>
            <p>{state.pausado ? 'A pausa geral está ativa.' : 'A pausa geral está desativada.'}</p>
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                if (!state.pausado && !window.confirm('Pausar todos os envios?')) return;
                void action(async () => {
                  await operations.pause(!state.pausado);
                  setState(await operations.state());
                });
              }}
            >
              {state.pausado ? 'Retomar operação' : 'Pausar todos os envios'}
            </button>
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  setState(await operations.state());
                  const h = await operations.history(page);
                  setHistory(h.envios);
                  setMore(h.mais);
                  setPending(await operations.pending());
                })
              }
            >
              Atualizar
            </button>
          </section>
          <section className="card" aria-label="Pendências">
            <h2 className="card-title">Pendências</h2>
            {pending && !pending.excecoes.length && !pending.envios.length && <p>Nenhuma pendência aberta.</p>}
            {pending?.excecoes.map((e) => (
              <article key={e.id} style={{ marginBottom: 16 }}>
                <p>{e.descricao}</p>
                <a href={repairLink(e.tipo, e.fonte_id)}>Abrir conserto</a>
              </article>
            ))}
            {!!pending?.envios.length && (
              <p>
                {pending.envios.length} {pending.envios.length === 1 ? 'oferta' : 'ofertas'} com falha ou sem
                confirmação. <a href="/ajuda#falhas">Ver o que fazer</a>. Ofertas sem confirmação não são reenviadas
                automaticamente para evitar repetição.
              </p>
            )}
          </section>
        </>
      )}
      <section id="pareamento" className="card" aria-label="Pareamento do WhatsApp">
        <h2 className="card-title">Pareamento do WhatsApp</h2>
        <p>Ensaio: nenhum número será conectado.</p>
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => action(async () => setPair(await operations.pair()))}
        >
          Ver exemplo de código e QR
        </button>
        {pair && (
          <div>
            <p>{pair.aviso}</p>
            <p>
              Código de exemplo: <strong>{pair.codigo}</strong>
            </p>
            <img
              src={pair.qr}
              alt="QR de demonstração, sem conexão ao WhatsApp"
              width="220"
              height="220"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          </div>
        )}
      </section>
      <section className="card" aria-label="Notificações">
        <h2 className="card-title">Notificações</h2>
        <p>Receba um aviso quando surgir uma pendência. Ative apenas neste dispositivo de confiança.</p>
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => action(async () => setNotice(await operations.enablePush()))}
        >
          Ativar notificações
        </button>
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() =>
            action(async () => {
              await operations.disablePush();
              setNotice('Notificações desativadas neste navegador.');
            })
          }
        >
          Desativar notificações
        </button>
      </section>
      <section className="card" aria-label="Histórico">
        <h2 className="card-title">Enviadas e descartadas</h2>
        {!history.length && <p>Nenhum envio nesta página.</p>}
        {history.map((e) => (
          <article key={e.id} style={{ marginBottom: 16 }}>
            <strong>{e.titulo ?? e.id_loja}</strong>
            <p>
              {e.estado === 'descartado' ? 'Descartada' : e.simulado ? 'Simulada — não enviada ao grupo' : 'Enviada'}
            </p>
            <time dateTime={e.criado_em}>{new Date(e.criado_em).toLocaleString('pt-BR')}</time>
            {e.estado === 'descartado' && <p>{e.motivo_legivel ?? 'Descartada pelo filtro.'}</p>}
          </article>
        ))}
        <button className="btn btn-secondary" disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>
          Anterior
        </button>{' '}
        <span>Página {page}</span>{' '}
        <button className="btn btn-secondary" disabled={!more || busy} onClick={() => setPage(page + 1)}>
          Próxima
        </button>
      </section>
    </div>
  );
}
