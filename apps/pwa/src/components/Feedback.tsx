import React from 'react';

export type FeedbackMsg = {
  tipo: 'sucesso' | 'erro';
  texto: React.ReactNode;
  acao?: {
    label: string;
    onClick: () => void;
  };
};

export function Feedback({ msg }: { msg: FeedbackMsg | null }) {
  if (!msg) return null;
  return (
    <div className={`feedback-msg feedback-${msg.tipo}`} role={msg.tipo === 'sucesso' ? 'status' : 'alert'}>
      {msg.texto}
      {msg.acao && (
        <button
          type="button"
          className="btn-feedback-action"
          onClick={msg.acao.onClick}
          style={{
            marginLeft: '8px',
            textDecoration: 'underline',
            background: 'none',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            fontWeight: 600,
            padding: 0,
          }}
        >
          {msg.acao.label}
        </button>
      )}
    </div>
  );
}
