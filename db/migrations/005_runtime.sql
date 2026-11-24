ALTER TABLE envios ADD COLUMN simulado boolean NOT NULL DEFAULT false;
ALTER TABLE eventos_oferta ADD COLUMN simulado boolean NOT NULL DEFAULT false;
CREATE TABLE ingestao_pendente (
  mensagem_bruta_id uuid PRIMARY KEY REFERENCES mensagens_brutas(id),
  destino_id text NOT NULL,
  concluida boolean NOT NULL DEFAULT false,
  tentar_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingestao_proxima ON ingestao_pendente(tentar_em) WHERE NOT concluida;
