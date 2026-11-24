import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Feedback, type FeedbackMsg } from '../components/Feedback.js';

interface Props {
  apiClient?: typeof api;
}

export function NicheConfigPage({ apiClient = api }: Props) {
  const [palavrasNicho, setPalavrasNicho] = useState<string[]>([]);
  const [palavrasProibidas, setPalavrasProibidas] = useState<string[]>([]);
  const [novaPalavraNicho, setNovaPalavraNicho] = useState('');
  const [novaPalavraProibida, setNovaPalavraProibida] = useState('');
  const [erroNicho, setErroNicho] = useState<string | null>(null);
  const [erroProibida, setErroProibida] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [feedback, setFeedback] = useState<FeedbackMsg | null>(null);

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
    } catch {
      setFeedback({ tipo: 'erro', texto: 'Não foi possível carregar as palavras. Tente novamente mais tarde.' });
    } finally {
      setCarregando(false);
    }
  }

  async function adicionarNicho(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setErroNicho(null);
    const termo = novaPalavraNicho.trim().toLowerCase();
    if (!termo) {
      setErroNicho('Informe uma palavra para adicionar ao nicho.');
      return;
    }
    if (palavrasNicho.includes(termo)) {
      setErroNicho('Esta palavra já está na lista do nicho.');
      return;
    }

    const anterior = [...palavrasNicho];
    const novaLista = [...palavrasNicho, termo];
    setPalavrasNicho(novaLista);
    setNovaPalavraNicho('');
    setFeedback(null);

    try {
      await apiClient.updateConfig({
        palavras_chave: novaLista,
        palavras_bloqueadas: palavrasProibidas,
      });
      setFeedback({ tipo: 'sucesso', texto: 'Salvo' });
    } catch (err) {
      console.error(err);
      setPalavrasNicho(anterior);
      setFeedback({
        tipo: 'erro',
        texto: `Não deu para salvar “${termo}”. Confira a internet e tente de novo. A lista voltou ao que era.`,
      });
    }
  }

  async function readicionarNicho(termo: string) {
    const anterior = [...palavrasNicho];
    if (palavrasNicho.includes(termo)) return;
    const novaLista = [...palavrasNicho, termo];
    setPalavrasNicho(novaLista);
    try {
      await apiClient.updateConfig({
        palavras_chave: novaLista,
        palavras_bloqueadas: palavrasProibidas,
      });
      setFeedback({ tipo: 'sucesso', texto: 'Salvo' });
    } catch (err) {
      console.error(err);
      setPalavrasNicho(anterior);
      setFeedback({
        tipo: 'erro',
        texto: `Não deu para salvar “${termo}”. Confira a internet e tente de novo. A lista voltou ao que era.`,
      });
    }
  }

  async function removerNicho(index: number) {
    const termoRemovido = palavrasNicho[index];
    const anterior = [...palavrasNicho];
    const novaLista = palavrasNicho.filter((_, i) => i !== index);
    setPalavrasNicho(novaLista);
    setFeedback(null);

    try {
      await apiClient.updateConfig({
        palavras_chave: novaLista,
        palavras_bloqueadas: palavrasProibidas,
      });
      setFeedback({
        tipo: 'sucesso',
        texto: `“${termoRemovido}” removida.`,
        acao: {
          label: 'Desfazer',
          onClick: () => {
            void readicionarNicho(termoRemovido);
          },
        },
      });
    } catch (err) {
      console.error(err);
      setPalavrasNicho(anterior);
      setFeedback({
        tipo: 'erro',
        texto: `Não deu para salvar “${termoRemovido}”. Confira a internet e tente de novo. A lista voltou ao que era.`,
      });
    }
  }

  async function adicionarProibida(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setErroProibida(null);
    const termo = novaPalavraProibida.trim().toLowerCase();
    if (!termo) {
      setErroProibida('Informe uma palavra para a lista de bloqueio.');
      return;
    }
    if (palavrasProibidas.includes(termo)) {
      setErroProibida('Esta palavra já está na lista de proibidas.');
      return;
    }

    const anterior = [...palavrasProibidas];
    const novaLista = [...palavrasProibidas, termo];
    setPalavrasProibidas(novaLista);
    setNovaPalavraProibida('');
    setFeedback(null);

    try {
      await apiClient.updateConfig({
        palavras_chave: palavrasNicho,
        palavras_bloqueadas: novaLista,
      });
      setFeedback({ tipo: 'sucesso', texto: 'Salvo' });
    } catch (err) {
      console.error(err);
      setPalavrasProibidas(anterior);
      setFeedback({
        tipo: 'erro',
        texto: `Não deu para salvar “${termo}”. Confira a internet e tente de novo. A lista voltou ao que era.`,
      });
    }
  }

  async function readicionarProibida(termo: string) {
    const anterior = [...palavrasProibidas];
    if (palavrasProibidas.includes(termo)) return;
    const novaLista = [...palavrasProibidas, termo];
    setPalavrasProibidas(novaLista);
    try {
      await apiClient.updateConfig({
        palavras_chave: palavrasNicho,
        palavras_bloqueadas: novaLista,
      });
      setFeedback({ tipo: 'sucesso', texto: 'Salvo' });
    } catch (err) {
      console.error(err);
      setPalavrasProibidas(anterior);
      setFeedback({
        tipo: 'erro',
        texto: `Não deu para salvar “${termo}”. Confira a internet e tente de novo. A lista voltou ao que era.`,
      });
    }
  }

  async function removerProibida(index: number) {
    const termoRemovido = palavrasProibidas[index];
    const anterior = [...palavrasProibidas];
    const novaLista = palavrasProibidas.filter((_, i) => i !== index);
    setPalavrasProibidas(novaLista);
    setFeedback(null);

    try {
      await apiClient.updateConfig({
        palavras_chave: palavrasNicho,
        palavras_bloqueadas: novaLista,
      });
      setFeedback({
        tipo: 'sucesso',
        texto: `“${termoRemovido}” removida.`,
        acao: {
          label: 'Desfazer',
          onClick: () => {
            void readicionarProibida(termoRemovido);
          },
        },
      });
    } catch (err) {
      console.error(err);
      setPalavrasProibidas(anterior);
      setFeedback({
        tipo: 'erro',
        texto: `Não deu para salvar “${termoRemovido}”. Confira a internet e tente de novo. A lista voltou ao que era.`,
      });
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

      <Feedback msg={feedback} />

      {/* Seção 1: Palavras do nicho */}
      <div className="card">
        <h2 className="card-title">Palavras do nicho</h2>
        <p className="card-desc">Termos que identificam os produtos que você deseja enviar aos seus grupos.</p>

        <form onSubmit={adicionarNicho} className="input-add-group">
          <div style={{ flex: 1 }}>
            <label htmlFor="input-palavra-nicho" className="form-label">
              Adicionar ao nicho
            </label>
            <input
              id="input-palavra-nicho"
              type="text"
              className="form-input"
              placeholder="Ex: suporte veicular, pneu..."
              value={novaPalavraNicho}
              onChange={(e) => {
                setNovaPalavraNicho(e.target.value);
                setErroNicho(null);
              }}
              aria-invalid={erroNicho ? 'true' : 'false'}
              aria-describedby={erroNicho ? 'erro-input-nicho' : undefined}
            />
            {erroNicho && (
              <span id="erro-input-nicho" className="field-error" role="alert">
                {erroNicho}
              </span>
            )}
          </div>
          <button type="submit" className="btn btn-add" style={{ alignSelf: 'flex-start', marginTop: '24px' }}>
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
                onClick={() => void removerNicho(idx)}
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
          <div style={{ flex: 1 }}>
            <label htmlFor="input-palavra-proibida" className="form-label">
              Adicionar palavra proibida
            </label>
            <input
              id="input-palavra-proibida"
              type="text"
              className="form-input"
              placeholder="Ex: brinquedo, carrinho de bebê..."
              value={novaPalavraProibida}
              onChange={(e) => {
                setNovaPalavraProibida(e.target.value);
                setErroProibida(null);
              }}
              aria-invalid={erroProibida ? 'true' : 'false'}
              aria-describedby={erroProibida ? 'erro-input-proibida' : undefined}
            />
            {erroProibida && (
              <span id="erro-input-proibida" className="field-error" role="alert">
                {erroProibida}
              </span>
            )}
          </div>
          <button type="submit" className="btn btn-add" style={{ alignSelf: 'flex-start', marginTop: '24px' }}>
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
                onClick={() => void removerProibida(idx)}
                aria-label={`Remover ${palavra}`}
              >
                &times;
              </button>
            </span>
          ))}
          {palavrasProibidas.length === 0 && <span className="card-desc">Nenhuma palavra proibida cadastrada.</span>}
        </div>
      </div>
    </div>
  );
}
