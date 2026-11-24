export type FeedbackMsg = { tipo: 'sucesso' | 'erro'; texto: string };

export function Feedback({ msg }: { msg: FeedbackMsg | null }) {
  if (!msg) return null;
  return (
    <div className={`feedback-msg feedback-${msg.tipo}`} role={msg.tipo === 'sucesso' ? 'status' : 'alert'}>
      {msg.texto}
    </div>
  );
}
