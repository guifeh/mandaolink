import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Feedback, type FeedbackMsg } from '../components/Feedback.js';

interface Props {
  apiClient?: typeof api;
}

export function AffiliateAccountPage({ apiClient = api }: Props) {
  const [tagAmazon, setTagAmazon] = useState('');
  const [tagOriginal, setTagOriginal] = useState('');
  const [confirmandoTroca, setConfirmandoTroca] = useState(false);
  const [erroTag, setErroTag] = useState<string | null>(null);
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
      const tag = conf.tag_amazon ?? '';
      setTagAmazon(tag);
      setTagOriginal(tag);
      setFeedback(null);
    } catch {
      setFeedback({ tipo: 'erro', texto: 'Não foi possível carregar a tag. Tente novamente mais tarde.' });
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

  async function executarSalvar(tag: string) {
    try {
      setSalvando(true);
      setFeedback(null);
      await apiClient.updateConfig({
        tag_amazon: tag,
      });
      setTagOriginal(tag);
      setConfirmandoTroca(false);
      setFeedback({ tipo: 'sucesso', texto: 'Tag da Amazon salva com sucesso!' });
    } catch (err) {
      console.error(err);
      setFeedback({
        tipo: 'erro',
        texto: 'Não foi possível salvar a tag da Amazon. Confira a conexão e tente de novo.',
      });
    } finally {
      setSalvando(false);
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErroTag(null);
    const erroValidacao = validarTag(tagAmazon);
    if (erroValidacao) {
      setErroTag(erroValidacao);
      return;
    }

    const tagLimpa = tagAmazon.trim().toLowerCase();

    // Se já havia tag cadastrada e ela está sendo alterada, pede confirmação
    if (tagOriginal && tagLimpa !== tagOriginal) {
      setConfirmandoTroca(true);
      return;
    }

    await executarSalvar(tagLimpa);
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

      {/* Caixa de confirmação para troca de tag */}
      {confirmandoTroca && (
        <div
          className="card"
          role="alert"
          style={{
            borderColor: '#f59e0b',
            background: '#fffbeb',
            marginBottom: '16px',
          }}
        >
          <p style={{ fontWeight: 600, color: '#92400e', marginBottom: '12px' }}>
            Trocar a tag muda para onde vão as comissões dos próximos envios. Os links já publicados continuam com a tag
            antiga. Continuar?
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void executarSalvar(tagAmazon.trim().toLowerCase())}
              disabled={salvando}
            >
              {salvando ? 'Salvando…' : 'Confirmar e salvar'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setConfirmandoTroca(false);
                setTagAmazon(tagOriginal);
              }}
              disabled={salvando}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

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
              onChange={(e) => {
                setTagAmazon(e.target.value.toLowerCase());
                setErroTag(null);
                setConfirmandoTroca(false);
              }}
              aria-invalid={erroTag ? 'true' : 'false'}
              aria-describedby={erroTag ? 'erro-tag-amazon' : undefined}
              required
            />
            {erroTag && (
              <span id="erro-tag-amazon" className="field-error" role="alert">
                {erroTag}
              </span>
            )}
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar tag da Amazon'}
        </button>
      </form>
    </div>
  );
}
