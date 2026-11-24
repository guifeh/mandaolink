import { useState, useEffect } from 'react';
import { NicheConfigPage } from './pages/NicheConfig.js';
import { ScheduleLimitsPage } from './pages/ScheduleLimits.js';
import { AffiliateAccountPage } from './pages/AffiliateAccount.js';
import { OperationsPage } from './pages/Operations.js';
import { SourcesPage } from './pages/Sources.js';
import { HelpPage } from './pages/Help.js';

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
        {activeTab === 'fontes' && <SourcesPage />}
        {activeTab === 'ajuda' && <HelpPage />}
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
