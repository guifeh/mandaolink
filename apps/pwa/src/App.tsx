import { useState, useEffect } from 'react';
import { NicheConfigPage } from './pages/NicheConfig.js';
import { ScheduleLimitsPage } from './pages/ScheduleLimits.js';
import { AffiliateAccountPage } from './pages/AffiliateAccount.js';
import { OperationsPage } from './pages/Operations.js';

export type TabKey = 'nicho' | 'horarios' | 'afiliado' | 'operacao' | 'fontes' | 'ajuda';

export function getTabFromHash(hashString?: string, pathname?: string): TabKey {
  const path = pathname ?? (hashString === undefined && typeof window !== 'undefined' ? window.location.pathname : '/');
  if (path === '/fontes') return 'fontes';
  if (path === '/ajuda') return 'ajuda';
  let hash = '';
  if (hashString !== undefined) {
    hash = hashString.replace(/^#\/?/, '').toLowerCase();
  } else if (typeof window !== 'undefined') {
    hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  }
  if (hash === 'nicho' || hash === 'horarios' || hash === 'afiliado' || hash === 'operacao') {
    return hash;
  }
  if (hash === 'pareamento') {
    return 'operacao';
  }
  return 'operacao';
}

export function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(() => getTabFromHash());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleHashChange = () => {
      setActiveTab(getTabFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, []);

  const navigateTo = (tab: TabKey) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', tab === 'operacao' ? '/' : `/#${tab}`);
    }
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="app-title">MandaoLink</div>
      </header>

      <main className="main-content">
        {activeTab === 'nicho' && <NicheConfigPage />}
        {activeTab === 'horarios' && <ScheduleLimitsPage />}
        {activeTab === 'afiliado' && <AffiliateAccountPage />}
        {activeTab === 'operacao' && <OperationsPage />}
        {activeTab === 'fontes' && (
          <section aria-labelledby="fontes-title">
            <h1 id="fontes-title" className="page-title">
              Fontes
            </h1>
            <p>A tela de fontes está em preparação.</p>
            <p>
              Se uma fonte foi perdida, confira no WhatsApp se o número conectado ainda participa do grupo. Peça a quem
              administra o grupo para adicioná-lo de novo, se necessário.
            </p>
            <p>
              Depois, volte ao Início e atualize as pendências. Se o aviso continuar, peça ajuda a quem administra o
              MandaoLink.
            </p>
            <a href="/">Voltar ao Início</a>
          </section>
        )}
        {activeTab === 'ajuda' && (
          <section aria-labelledby="ajuda-title">
            <h1 id="ajuda-title" className="page-title">
              Como resolver a pendência
            </h1>
            <section id="numero-bloqueado" className="card">
              <h2 className="card-title">Número bloqueado</h2>
              <p>
                Confira o bloqueio no WhatsApp do celular e troque o chip com a ajuda de quem administra o MandaoLink.
                Tentar conectar o mesmo número novamente não resolve o bloqueio.
              </p>
            </section>
            <section id="grupo-destino" className="card">
              <h2 className="card-title">Sem acesso ao grupo de destino</h2>
              <p>
                Peça a quem administra o grupo do cliente para adicionar o número conectado de novo. Depois, volte ao
                Início e atualize as pendências.
              </p>
            </section>
            <section id="falhas" className="card">
              <h2 className="card-title">Envios com falha ou sem confirmação</h2>
              <p>
                Confira a conexão no celular. Ofertas sem confirmação não são reenviadas automaticamente para evitar
                repetição. Se a operação parou por falhas, peça a quem administra o MandaoLink para verificar a causa
                antes de retomar.
              </p>
            </section>
            <p>
              Para outros avisos, informe a descrição da pendência a quem administra o MandaoLink. Depois do conserto,
              volte ao Início e atualize.
            </p>
            <a href="/">Voltar ao Início</a>
          </section>
        )}
      </main>

      <nav className="bottom-nav">
        <button
          type="button"
          className={`nav-item ${activeTab === 'operacao' ? 'active' : ''}`}
          onClick={() => navigateTo('operacao')}
          aria-label="Aba Início"
          aria-current={activeTab === 'operacao' ? 'page' : undefined}
        >
          <span>Início</span>
        </button>
        <button
          type="button"
          className={`nav-item ${activeTab === 'nicho' ? 'active' : ''}`}
          onClick={() => navigateTo('nicho')}
          aria-label="Aba Nicho"
        >
          <span className="nav-icon">🏷️</span>
          <span>Nicho</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'horarios' ? 'active' : ''}`}
          onClick={() => navigateTo('horarios')}
          aria-label="Aba Horários"
        >
          <span className="nav-icon">⏱️</span>
          <span>Horários</span>
        </button>

        <button
          type="button"
          className={`nav-item ${activeTab === 'afiliado' ? 'active' : ''}`}
          onClick={() => navigateTo('afiliado')}
          aria-label="Aba Afiliado"
        >
          <span className="nav-icon">🛒</span>
          <span>Afiliado</span>
        </button>
      </nav>
    </div>
  );
}

export default App;
