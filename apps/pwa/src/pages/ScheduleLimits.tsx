import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { Feedback, type FeedbackMsg } from '../components/Feedback.js';

interface ScheduleConfigState {
  horario_inicio: string;
  horario_fim: string;
  limite_hora: number;
  limite_dia: number;
}

interface Props {
  apiClient?: typeof api;
}

export function ScheduleLimitsPage({ apiClient = api }: Props) {
  const [horarioInicio, setHorarioInicio] = useState('08:00');
  const [horarioFim, setHorarioFim] = useState('22:00');
  const [maximoPorHora, setMaximoPorHora] = useState(5);
  const [maximoPorDia, setMaximoPorDia] = useState(30);
  const [configOriginal, setConfigOriginal] = useState<ScheduleConfigState>({
    horario_inicio: '08:00',
    horario_fim: '22:00',
    limite_hora: 5,
    limite_dia: 30,
  });

  const [erroHorarios, setErroHorarios] = useState<string | null>(null);
  const [erroLimites, setErroLimites] = useState<string | null>(null);
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
      const inicio = conf.horario_inicio ? conf.horario_inicio.slice(0, 5) : '08:00';
      const fim = conf.horario_fim ? conf.horario_fim.slice(0, 5) : '22:00';
      const hora = conf.limite_hora ?? 5;
      const dia = conf.limite_dia ?? 30;

      setHorarioInicio(inicio);
      setHorarioFim(fim);
      setMaximoPorHora(hora);
      setMaximoPorDia(dia);
      setConfigOriginal({
        horario_inicio: inicio,
        horario_fim: fim,
        limite_hora: hora,
        limite_dia: dia,
      });
      setFeedback(null);
    } catch {
      setFeedback({ tipo: 'erro', texto: 'Não foi possível carregar os horários. Tente novamente mais tarde.' });
    } finally {
      setCarregando(false);
    }
  }

  const passaMeiaNoite = horarioInicio > horarioFim;
  const temMudancas =
    horarioInicio !== configOriginal.horario_inicio ||
    horarioFim !== configOriginal.horario_fim ||
    maximoPorHora !== configOriginal.limite_hora ||
    maximoPorDia !== configOriginal.limite_dia;

  function validar(): boolean {
    let valido = true;
    setErroHorarios(null);
    setErroLimites(null);

    if (!horarioInicio || !horarioFim) {
      setErroHorarios('Informe o horário de início e término.');
      valido = false;
    } else if (horarioInicio.slice(0, 5) === horarioFim.slice(0, 5)) {
      setErroHorarios('Os horários de início e término devem ser diferentes.');
      valido = false;
    }

    if (maximoPorHora <= 0) {
      setErroLimites('O máximo por hora deve ser pelo menos 1.');
      valido = false;
    } else if (maximoPorDia <= 0) {
      setErroLimites('O máximo por dia deve ser pelo menos 1.');
      valido = false;
    } else if (maximoPorHora > maximoPorDia) {
      setErroLimites('O limite por hora não pode ser maior que o limite diário.');
      valido = false;
    }

    return valido;
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!validar()) {
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

      setConfigOriginal({
        horario_inicio: horarioInicio,
        horario_fim: horarioFim,
        limite_hora: maximoPorHora,
        limite_dia: maximoPorDia,
      });
      setFeedback({ tipo: 'sucesso', texto: 'Horários e limites salvos com sucesso!' });
    } catch (err) {
      console.error(err);
      setFeedback({
        tipo: 'erro',
        texto: 'Não foi possível salvar os horários e limites. Confira a conexão e tente de novo.',
      });
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

      <Feedback msg={feedback} />

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
              onChange={(e) => {
                setHorarioInicio(e.target.value);
                setErroHorarios(null);
              }}
              aria-invalid={erroHorarios ? 'true' : 'false'}
              aria-describedby={erroHorarios ? 'erro-horarios' : passaMeiaNoite ? 'dica-madrugada' : undefined}
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
              onChange={(e) => {
                setHorarioFim(e.target.value);
                setErroHorarios(null);
              }}
              aria-invalid={erroHorarios ? 'true' : 'false'}
              aria-describedby={erroHorarios ? 'erro-horarios' : passaMeiaNoite ? 'dica-madrugada' : undefined}
              required
            />
            {passaMeiaNoite && !erroHorarios && (
              <span id="dica-madrugada" className="form-hint">
                termina no dia seguinte
              </span>
            )}
          </div>

          {erroHorarios && (
            <span id="erro-horarios" className="field-error" role="alert">
              {erroHorarios}
            </span>
          )}
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
              onChange={(e) => {
                setMaximoPorHora(parseInt(e.target.value, 10) || 0);
                setErroLimites(null);
              }}
              aria-invalid={erroLimites ? 'true' : 'false'}
              aria-describedby={erroLimites ? 'erro-limites' : undefined}
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
              onChange={(e) => {
                setMaximoPorDia(parseInt(e.target.value, 10) || 0);
                setErroLimites(null);
              }}
              aria-invalid={erroLimites ? 'true' : 'false'}
              aria-describedby={erroLimites ? 'erro-limites' : undefined}
              required
            />
          </div>

          {erroLimites && (
            <span id="erro-limites" className="field-error" role="alert">
              {erroLimites}
            </span>
          )}
        </div>

        {temMudancas && (
          <button type="submit" className="btn btn-primary" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </button>
        )}
      </form>
    </div>
  );
}
