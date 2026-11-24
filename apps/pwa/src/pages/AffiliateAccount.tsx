import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Feedback, type FeedbackMsg } from '../components/Feedback.js';

interface Props {
  apiClient?: typeof api;
}

export function AffiliateAccountPage({ apiClient = api }: Props) {
  const [tagAmazon, setTagAmazon] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackMsg | null>(null);

  useEffect(() => {
    void carregar();
  }, []);

  async function carregar() {
    try {
      setCarregando(true);
      const conf = await apiClient.fetchConfig();
      setTagAmazon(conf.tag_amazon ?? '');
      setFeedback(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar';
      setFeedback({ tipo: 'erro', texto: msg });
    } finally {
      setCarregando(false);
    }
  }

  function validarTag(tag: string): string | null {
    const limpa = tag.trim();
    if (!limpa) {
      return 'Por favor, informe a tag de afiliado.';
    }
    // Formato oficial de ID de associado Amazon: termina com -20 (ex: minhatag-20)
    const regexTag = /^[a-z0-9][a-z0-9-]{1,30}-20$/;
    if (!regexTag.test(limpa)) {
      return 'A tag da Amazon deve seguir o formato nome-20 (letras minúsculas, números ou hífens, terminando em -20). Exemplo: meucanal-20';
    }
    return null;
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const erroValidacao = validarTag(tagAmazon);
    if (erroValidacao) {
      setFeedback({ tipo: 'erro', texto: erroValidacao });
      return;
    }

    try {
      setSalvando(true);
      setFeedback(null);
      await apiClient.updateConfig({
        tag_amazon: tagAmazon.trim().toLowerCase(),
      });
      setFeedback({ tipo: 'sucesso', texto: 'Tag da Amazon salva com sucesso!' });
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
        <p className="card-desc">Carregando dados da conta...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Conta de Afiliado</h1>
        <p className="page-desc">Configure seu identificador oficial da Amazon para comissionamento das vendas.</p>
      </div>

      <Feedback msg={feedback} />

      <form onSubmit={salvar}>
        <div className="card">
          <h2 className="card-title">Tag da Amazon</h2>
          <p className="card-desc">
            Seu ID de Associados da Amazon. Todos os links enviados conterão exclusivamente esta tag.
          </p>

          <div className="form-group">
            <label className="form-label" htmlFor="tag-amazon">
              ID de Associado (termina com -20)
            </label>
            <input
              id="tag-amazon"
              type="text"
              className="form-input"
              placeholder="exemplo: meucanal-20"
              value={tagAmazon}
              onChange={(e) => setTagAmazon(e.target.value.toLowerCase())}
              required
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={salvando}>
          {salvando ? 'Salvando...' : 'Salvar tag da Amazon'}
        </button>
      </form>
    </div>
  );
}
