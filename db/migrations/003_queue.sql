ALTER TABLE envios ADD COLUMN produto_snapshot jsonb;
ALTER TABLE envios ADD COLUMN tentado_em timestamptz;
ALTER TABLE envios ADD COLUMN nao_antes_em timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z';
CREATE INDEX envios_tentativas ON envios (tentado_em) WHERE tentado_em IS NOT NULL;
CREATE TABLE controle_fila (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  proximo_envio_em timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z'
);
INSERT INTO controle_fila DEFAULT VALUES;
