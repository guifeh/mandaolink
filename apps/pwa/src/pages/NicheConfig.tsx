import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

interface Props {
  apiClient?: typeof api;
}

export function NicheConfigPage({ apiClient = api }: Props) {
  const [palavrasNicho, setPalavrasNicho] = useState<string[]>([]);
  const [palavrasProibidas, setPalavrasProibidas] = useState<string[]>([]);
  const [novaPalavraNicho, setNovaPalavraNicho] = useState('');
  const [novaPalavraProibida, setNovaPalavraProibida] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    void carregar();
  }, []);

  async function carregar() {
    try {
      setCarregando(true);
      const conf = await apiClient.fetchConfig();
      setPalavrasNicho(conf.palavras_chave ?? []);
      setPalavrasProibidas(conf.palavras_bloqueadas ?? []);
      setFeedback(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar';
      setFeedback({ tipo: 'erro', texto: msg });
    } finally {
      setCarregando(false);
    }
  }

  function adicionarNicho(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const termo = novaPalavraNicho.trim().toLowerCase();
    if (!termo) return;
    if (palavrasNicho.includes(termo)) {
      setFeedback({ tipo: 'erro', texto: 'Esta palavra já está na lista do nicho.' });
      return;
    }
    setPalavrasNicho([...palavrasNicho, termo]);
    setNovaPalavraNicho('');
    setFeedback(null);
  }

  function removerNicho(index: number) {
    setPalavrasNicho(palavrasNicho.filter((_, i) => i !== index));
  }

  function adicionarProibida(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const termo = novaPalavraProibida.trim().toLowerCase();
    if (!termo) return;
    if (palavrasProibidas.includes(termo)) {
      setFeedback({ tipo: 'erro', texto: 'Esta palavra já está na lista de proibidas.' });
      return;
    }
    setPalavrasProibidas([...palavrasProibidas, termo]);
    setNovaPalavraProibida('');
    setFeedback(null);
  }

  function removerProibida(index: number) {
    setPalavrasProibidas(palavrasProibidas.filter((_, i) => i !== index));
  }

  async function salvar() {
    try {
      setSalvando(true);
      setFeedback(null);
      await apiClient.updateConfig({
        palavras_chave: palavrasNicho,
        palavras_bloqueadas: palavrasProibidas,
      });
      setFeedback({ tipo: 'sucesso', texto: 'Palavras do nicho salvas com sucesso!' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar alterações';
      setFeedback({ tipo: 'erro', texto: msg });
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <div className="card">
        <p className="card-desc">Carregando palavras do nicho...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Filtro de Conteúdo</h1>
        <p className="page-desc">Defina quais produtos fazem parte do seu nicho e quais devem ser ignorados.</p>
      </div>

      {feedback && <div className={`feedback-msg feedback-${feedback.tipo}`}>{feedback.texto}</div>}

      {/* Seção 1: Palavras do nicho */}
      <div className="card">
        <h2 className="card-title">Palavras do nicho</h2>
        <p className="card-desc">Termos que identificam os produtos que você deseja enviar aos seus grupos.</p>

        <form onSubmit={adicionarNicho} className="input-add-group">
          <input
            type="text"
            className="form-input"
            placeholder="Ex: suporte veicular, pneu..."
            value={novaPalavraNicho}
            onChange={(e) => setNovaPalavraNicho(e.target.value)}
          />
          <button type="submit" className="btn btn-add">
            Adicionar
          </button>
        </form>

        <div className="tags-list">
          {palavrasNicho.map((palavra, idx) => (
            <span key={idx} className="tag-badge">
              {palavra}
              <button
                type="button"
                className="tag-remove"
                onClick={() => removerNicho(idx)}
                aria-label={`Remover ${palavra}`}
              >
                &times;
              </button>
            </span>
          ))}
          {palavrasNicho.length === 0 && <span className="card-desc">Nenhuma palavra cadastrada ainda.</span>}
        </div>
      </div>

      {/* Seção 2: Palavras proibidas */}
      <div className="card">
        <h2 className="card-title">Palavras proibidas</h2>
        <p className="card-desc">Produtos com qualquer uma destas palavras serão descartados automaticamente.</p>

        <form onSubmit={adicionarProibida} className="input-add-group">
          <input
            type="text"
            className="form-input"
            placeholder="Ex: brinquedo, carrinho de bebê..."
            value={novaPalavraProibida}
            onChange={(e) => setNovaPalavraProibida(e.target.value)}
          />
          <button type="submit" className="btn btn-add">
            Adicionar
          </button>
        </form>

        <div className="tags-list">
          {palavrasProibidas.map((palavra, idx) => (
            <span key={idx} className="tag-badge tag-badge-proibida">
              {palavra}
              <button
                type="button"
                className="tag-remove"
                onClick={() => removerProibida(idx)}
                aria-label={`Remover ${palavra}`}
              >
                &times;
              </button>
            </span>
          ))}
          {palavrasProibidas.length === 0 && <span className="card-desc">Nenhuma palavra proibida cadastrada.</span>}
        </div>
      </div>

      <button type="button" className="btn btn-primary" onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando...' : 'Salvar alterações'}
      </button>
    </div>
  );
}
