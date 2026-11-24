import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

interface Props {
  apiClient?: typeof api;
}

export function ScheduleLimitsPage({ apiClient = api }: Props) {
  const [horarioInicio, setHorarioInicio] = useState('08:00');
  const [horarioFim, setHorarioFim] = useState('22:00');
  const [maximoPorHora, setMaximoPorHora] = useState(5);
  const [maximoPorDia, setMaximoPorDia] = useState(30);
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
      if (conf.horario_inicio) setHorarioInicio(conf.horario_inicio.slice(0, 5));
      if (conf.horario_fim) setHorarioFim(conf.horario_fim.slice(0, 5));
      if (conf.limite_hora) setMaximoPorHora(conf.limite_hora);
      if (conf.limite_dia) setMaximoPorDia(conf.limite_dia);
      setFeedback(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao carregar';
      setFeedback({ tipo: 'erro', texto: msg });
    } finally {
      setCarregando(false);
    }
  }

  function validar(): string | null {
    if (!horarioInicio || !horarioFim) {
      return 'Informe o horário de início e término.';
    }
    if (horarioInicio >= horarioFim) {
      return 'O horário de início deve ser anterior ao horário de término.';
    }
    if (maximoPorHora <= 0) {
      return 'O máximo por hora deve ser pelo menos 1.';
    }
    if (maximoPorDia <= 0) {
      return 'O máximo por dia deve ser pelo menos 1.';
    }
    if (maximoPorHora > maximoPorDia) {
      return 'O limite por hora não pode ser maior que o limite diário.';
    }
    return null;
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const erroValidacao = validar();
    if (erroValidacao) {
      setFeedback({ tipo: 'erro', texto: erroValidacao });
      return;
    }

    try {
      setSalvando(true);
      setFeedback(null);
      await apiClient.updateConfig({
        horario_inicio: horarioInicio.slice(0, 5),
        horario_fim: horarioFim.slice(0, 5),
        limite_hora: Number(maximoPorHora),
        limite_dia: Number(maximoPorDia),
      });
      setFeedback({ tipo: 'sucesso', texto: 'Horários e limites salvos com sucesso!' });
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
        <p className="card-desc">Carregando horários e limites...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Horários e Limites</h1>
        <p className="page-desc">Controle em quais períodos e com que frequência as mensagens são enviadas.</p>
      </div>

      {feedback && <div className={`feedback-msg feedback-${feedback.tipo}`}>{feedback.texto}</div>}

      <form onSubmit={salvar}>
        {/* Seção 1: Horários de envio */}
        <div className="card">
          <h2 className="card-title">Horários de envio</h2>
          <p className="card-desc">Defina o período diário em que o sistema pode postar mensagens nos grupos.</p>

          <div className="form-group">
            <label className="form-label" htmlFor="horario-inicio">
              Início do envio
            </label>
            <input
              id="horario-inicio"
              type="time"
              className="form-input"
              value={horarioInicio}
              onChange={(e) => setHorarioInicio(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="horario-fim">
              Término do envio
            </label>
            <input
              id="horario-fim"
              type="time"
              className="form-input"
              value={horarioFim}
              onChange={(e) => setHorarioFim(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Seção 2: Limites de envio */}
        <div className="card">
          <h2 className="card-title">Limites de envio</h2>
          <p className="card-desc">
            Evite excesso de mensagens e bloqueios nos grupos limitando a quantidade de envios.
          </p>

          <div className="form-group">
            <label className="form-label" htmlFor="maximo-hora">
              Máximo por hora
            </label>
            <input
              id="maximo-hora"
              type="number"
              min="1"
              max="100"
              className="form-input"
              value={maximoPorHora}
              onChange={(e) => setMaximoPorHora(parseInt(e.target.value, 10) || 0)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="maximo-dia">
              Máximo por dia
            </label>
            <input
              id="maximo-dia"
              type="number"
              min="1"
              max="1000"
              className="form-input"
              value={maximoPorDia}
              onChange={(e) => setMaximoPorDia(parseInt(e.target.value, 10) || 0)}
              required
            />
          </div>
        </div>

        <button type="submit" className="btn btn-primary" disabled={salvando}>
          {salvando ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </form>
    </div>
  );
}
