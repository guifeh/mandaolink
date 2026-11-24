CREATE TABLE fontes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plataforma text NOT NULL CHECK (plataforma IN ('whatsapp', 'telegram')),
  identificador_externo text NOT NULL,
  nome text NOT NULL,
  ativa boolean NOT NULL DEFAULT false,
  autorizada_em timestamptz,
  criada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plataforma, identificador_externo),
  CHECK (NOT ativa OR autorizada_em IS NOT NULL)
);

CREATE TABLE mensagens_brutas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fonte_id uuid NOT NULL REFERENCES fontes(id),
  mensagem_externa_id text NOT NULL,
  conteudo jsonb NOT NULL,
  recebida_em timestamptz NOT NULL DEFAULT now(),
  publicada_em timestamptz NOT NULL,
  UNIQUE (fonte_id, mensagem_externa_id)
);

CREATE TABLE ofertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loja text NOT NULL CHECK (loja = 'amazon'),
  asin text NOT NULL CHECK (asin ~ '^[A-Z0-9]{10}$'),
  titulo text,
  preco_centavos bigint CHECK (preco_centavos >= 0),
  moeda text NOT NULL DEFAULT 'BRL' CHECK (moeda = 'BRL'),
  imagem_url text,
  disponivel boolean,
  verificada_em timestamptz,
  criada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loja, asin)
);

CREATE TABLE eventos_oferta (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  oferta_id uuid REFERENCES ofertas(id),
  mensagem_bruta_id uuid NOT NULL REFERENCES mensagens_brutas(id),
  gate smallint NOT NULL CHECK (gate BETWEEN 0 AND 9),
  resultado text NOT NULL CHECK (resultado IN ('PASSA', 'REPROVA', 'ADIA')),
  motivo text,
  tentar_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (resultado = 'PASSA' OR motivo IS NOT NULL),
  CHECK (resultado <> 'ADIA' OR tentar_em IS NOT NULL)
);
CREATE INDEX eventos_oferta_historico ON eventos_oferta (criado_em DESC, id DESC);
CREATE INDEX eventos_oferta_produto ON eventos_oferta (oferta_id, criado_em DESC);

CREATE TABLE envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oferta_id uuid NOT NULL REFERENCES ofertas(id),
  mensagem_bruta_id uuid NOT NULL REFERENCES mensagens_brutas(id),
  destino_id text NOT NULL,
  chave_idempotencia text NOT NULL UNIQUE,
  estado text NOT NULL DEFAULT 'na_fila' CHECK (estado IN ('na_fila', 'enviado', 'falhou', 'incerto')),
  texto text NOT NULL,
  texto_hash text NOT NULL,
  mensagem_externa_id text,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  enviado_em timestamptz,
  incerto_em timestamptz,
  CHECK (expira_em > criado_em),
  CHECK (estado <> 'enviado' OR (enviado_em IS NOT NULL AND mensagem_externa_id IS NOT NULL)),
  CHECK (estado <> 'incerto' OR incerto_em IS NOT NULL)
);
CREATE UNIQUE INDEX envios_um_pendente ON envios (oferta_id, destino_id) WHERE estado IN ('na_fila', 'incerto');
CREATE INDEX envios_fila ON envios (criado_em DESC) WHERE estado = 'na_fila';
CREATE INDEX envios_dedup ON envios (oferta_id, destino_id, enviado_em DESC) WHERE estado = 'enviado';

CREATE TABLE config_nicho (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nome text NOT NULL DEFAULT 'Carro',
  palavras_chave text[] NOT NULL DEFAULT '{}',
  palavras_bloqueadas text[] NOT NULL DEFAULT '{}',
  categorias text[] NOT NULL DEFAULT '{}',
  tag_amazon text NOT NULL DEFAULT '',
  limite_hora integer NOT NULL DEFAULT 5 CHECK (limite_hora BETWEEN 1 AND 100),
  limite_dia integer NOT NULL DEFAULT 30 CHECK (limite_dia BETWEEN 1 AND 1000),
  horario_inicio time NOT NULL DEFAULT '08:00',
  horario_fim time NOT NULL DEFAULT '22:00',
  fuso_horario text NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (fuso_horario = 'America/Sao_Paulo'),
  pausado boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (limite_hora <= limite_dia),
  CHECK (horario_inicio < horario_fim)
);
INSERT INTO config_nicho DEFAULT VALUES;

CREATE TABLE excecoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  descricao text NOT NULL,
  severidade text NOT NULL CHECK (severidade IN ('amarelo', 'vermelho')),
  fonte_id uuid REFERENCES fontes(id),
  criada_em timestamptz NOT NULL DEFAULT now(),
  resolvida_em timestamptz
);
CREATE INDEX excecoes_abertas ON excecoes (criada_em DESC) WHERE resolvida_em IS NULL;

CREATE TABLE auth_links (
  token_hash text PRIMARY KEY,
  expira_em timestamptz NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessoes (
  token_hash text PRIMARY KEY,
  expira_em timestamptz NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION impedir_alteracao_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'registro imutavel';
END;
$$;
CREATE TRIGGER mensagens_imutaveis BEFORE UPDATE OR DELETE ON mensagens_brutas FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_log();
CREATE TRIGGER eventos_imutaveis BEFORE UPDATE OR DELETE ON eventos_oferta FOR EACH ROW EXECUTE FUNCTION impedir_alteracao_log();

CREATE FUNCTION validar_transicao_envio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado <> NEW.estado AND NOT (
    (OLD.estado = 'na_fila' AND NEW.estado IN ('enviado', 'falhou', 'incerto')) OR
    (OLD.estado = 'incerto' AND NEW.estado = 'enviado')
  ) THEN
    RAISE EXCEPTION 'transicao de envio invalida: % -> %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER envios_transicoes BEFORE UPDATE ON envios FOR EACH ROW EXECUTE FUNCTION validar_transicao_envio();
