ALTER TABLE ofertas RENAME COLUMN asin TO id_loja;
ALTER TABLE ofertas RENAME CONSTRAINT ofertas_loja_asin_key TO ofertas_loja_id_loja_key;
ALTER TABLE ofertas DROP CONSTRAINT ofertas_asin_check;
ALTER TABLE ofertas ADD CONSTRAINT ofertas_id_loja_formato CHECK (loja = 'amazon' AND id_loja ~ '^[A-Z0-9]{10}$');
ALTER TABLE mensagens_brutas ADD COLUMN preco_anunciado_centavos bigint CHECK (preco_anunciado_centavos > 0);
ALTER TABLE mensagens_brutas ADD CONSTRAINT conteudo_minimo CHECK (jsonb_typeof(conteudo) = 'object' AND conteudo - 'texto' - 'link' = '{}'::jsonb);
ALTER TABLE envios ADD COLUMN preco_centavos bigint CHECK (preco_centavos > 0);
ALTER TABLE envios ADD COLUMN preco_lido_em timestamptz;
ALTER TABLE envios ADD COLUMN imagem_url text;
ALTER TABLE envios ADD COLUMN motivo_descarte text;
ALTER TABLE envios DROP CONSTRAINT envios_estado_check;
ALTER TABLE envios ADD CONSTRAINT envios_estado_check CHECK (estado IN ('na_fila','enviado','falhou','incerto','descartado'));
ALTER TABLE envios ADD CONSTRAINT descarte_motivo_obrigatorio CHECK (estado <> 'descartado' OR (motivo_descarte IS NOT NULL AND length(trim(motivo_descarte)) > 0));

CREATE OR REPLACE FUNCTION validar_transicao_envio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado <> NEW.estado AND NOT (
    (OLD.estado = 'na_fila' AND NEW.estado IN ('enviado','falhou','incerto','descartado')) OR
    (OLD.estado = 'incerto' AND NEW.estado = 'enviado')
  ) THEN
    RAISE EXCEPTION 'transicao de envio invalida: % -> %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END;
$$;
CREATE INDEX eventos_por_mensagem ON eventos_oferta (mensagem_bruta_id, criado_em DESC);
CREATE UNIQUE INDEX excecao_aberta_unica ON excecoes (tipo, fonte_id) NULLS NOT DISTINCT WHERE resolvida_em IS NULL;
ALTER TABLE config_nicho ADD CONSTRAINT tag_amazon_formato CHECK (tag_amazon = '' OR tag_amazon ~ '^[a-z0-9][a-z0-9-]{1,30}-20$');

CREATE FUNCTION validar_snapshot_envio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado = 'enviado' AND (TG_OP = 'INSERT' OR OLD.estado <> 'enviado') AND
     (NEW.preco_centavos IS NULL OR NEW.preco_lido_em IS NULL OR NEW.imagem_url IS NULL) THEN
    RAISE EXCEPTION 'snapshot do envio obrigatorio';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER snapshot_envio BEFORE INSERT OR UPDATE ON envios FOR EACH ROW EXECUTE FUNCTION validar_snapshot_envio();
