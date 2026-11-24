CREATE TABLE push_config (
  id smallint PRIMARY KEY CHECK (id=1), public_key text NOT NULL, private_key text NOT NULL
);
CREATE TABLE push_subscriptions (
  endpoint text PRIMARY KEY, subscription jsonb NOT NULL, criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_entregas (
  endpoint text REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
  excecao_id uuid REFERENCES excecoes(id), enviada_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(endpoint,excecao_id)
);
