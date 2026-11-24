export function HelpPage() {
  return (
    <section aria-labelledby="ajuda-title">
      <h1 id="ajuda-title" className="page-title">
        Como resolver a pendência
      </h1>
      <section id="numero-bloqueado" className="card">
        <h2 className="card-title">Número bloqueado</h2>
        <p>
          Confira o bloqueio no WhatsApp do celular e troque o chip com a ajuda de quem administra o MandaoLink. Tentar
          conectar o mesmo número novamente não resolve o bloqueio.
        </p>
      </section>
      <section id="grupo-destino" className="card">
        <h2 className="card-title">Sem acesso ao grupo de destino</h2>
        <p>
          Peça a quem administra o grupo do cliente para adicionar o número conectado de novo. Depois, volte ao Início e
          atualize as pendências.
        </p>
      </section>
      <section id="falhas" className="card">
        <h2 className="card-title">Envios com falha ou sem confirmação</h2>
        <p>
          Confira a conexão no celular. Ofertas sem confirmação não são reenviadas automaticamente para evitar
          repetição. Se a operação parou por falhas, peça a quem administra o MandaoLink para verificar a causa antes de
          retomar.
        </p>
      </section>
      <p>
        Para outros avisos, informe a descrição da pendência a quem administra o MandaoLink. Depois do conserto, volte
        ao Início e atualize.
      </p>
      <a href="/">Voltar ao Início</a>
    </section>
  );
}
