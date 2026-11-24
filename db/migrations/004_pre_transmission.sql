ALTER TABLE envios ADD COLUMN falha_pre_transmissao boolean NOT NULL DEFAULT false;
ALTER TABLE eventos_oferta ADD COLUMN prova_pre_transmissao jsonb;
ALTER TABLE eventos_oferta ADD COLUMN envio_id uuid REFERENCES envios(id);
ALTER TABLE eventos_oferta ADD CONSTRAINT prova_pre_transmissao_formato CHECK (
  prova_pre_transmissao IS NULL OR (
    envio_id IS NOT NULL AND jsonb_typeof(prova_pre_transmissao) = 'object' AND
    prova_pre_transmissao @> '{"naoTransmitido":true}'::jsonb AND
    jsonb_typeof(prova_pre_transmissao->'motivo') = 'string' AND
    prova_pre_transmissao ? 'motivo' AND
    length(trim(prova_pre_transmissao->>'motivo')) > 0
  )
);
CREATE OR REPLACE FUNCTION validar_transicao_envio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado <> NEW.estado AND NOT (
    (OLD.estado = 'na_fila' AND NEW.estado IN ('enviado','falhou','incerto','descartado')) OR
    (OLD.estado = 'incerto' AND NEW.estado = 'enviado') OR
    (OLD.estado = 'incerto' AND NEW.estado = 'falhou' AND NEW.falha_pre_transmissao AND NEW.mensagem_externa_id IS NULL AND length(trim(NEW.erro)) > 0)
  ) THEN
    RAISE EXCEPTION 'transicao de envio invalida: % -> %', OLD.estado, NEW.estado;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION exigir_prova_pre_transmissao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado='falhou' AND OLD.estado='incerto' AND NOT EXISTS (
    SELECT 1 FROM eventos_oferta WHERE envio_id=NEW.id AND prova_pre_transmissao @> '{"naoTransmitido":true}'::jsonb
  ) THEN
    RAISE EXCEPTION 'prova pre-transmissao ausente';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER prova_pre_transmissao_envio AFTER UPDATE ON envios DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION exigir_prova_pre_transmissao();

CREATE FUNCTION preservar_snapshot_envio() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado <> 'na_fila' AND OLD.preco_lido_em IS NOT NULL AND
    ROW(NEW.oferta_id,NEW.mensagem_bruta_id,NEW.destino_id,NEW.chave_idempotencia,NEW.texto,NEW.texto_hash,NEW.preco_centavos,NEW.preco_lido_em,NEW.imagem_url,NEW.produto_snapshot)
      IS DISTINCT FROM
    ROW(OLD.oferta_id,OLD.mensagem_bruta_id,OLD.destino_id,OLD.chave_idempotencia,OLD.texto,OLD.texto_hash,OLD.preco_centavos,OLD.preco_lido_em,OLD.imagem_url,OLD.produto_snapshot)
  THEN RAISE EXCEPTION 'snapshot do envio imutavel'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preservar_snapshot BEFORE UPDATE ON envios FOR EACH ROW EXECUTE FUNCTION preservar_snapshot_envio();
