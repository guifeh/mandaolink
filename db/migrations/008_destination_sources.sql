ALTER TABLE config_nicho ADD COLUMN destino_whatsapp_jid text
  CHECK (destino_whatsapp_jid IS NULL OR destino_whatsapp_jid ~ '^[0-9]+(-[0-9]+)?@g\.us$');

CREATE FUNCTION proteger_destino_fonte() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE destino text;
BEGIN
  IF TG_TABLE_NAME = 'fontes' THEN
    SELECT destino_whatsapp_jid INTO destino FROM config_nicho WHERE id=1 FOR UPDATE;
    IF NEW.ativa AND NEW.plataforma='whatsapp' AND NEW.identificador_externo=destino THEN
      RAISE EXCEPTION 'O grupo de destino nao pode ser uma fonte' USING ERRCODE='23514', CONSTRAINT='destino_nao_fonte';
    END IF;
  ELSE
    IF NEW.destino_whatsapp_jid IS NOT NULL AND EXISTS (
      SELECT 1 FROM fontes WHERE ativa AND plataforma='whatsapp' AND identificador_externo=NEW.destino_whatsapp_jid
    ) THEN
      RAISE EXCEPTION 'Desative a fonte antes de escolher o destino' USING ERRCODE='23514', CONSTRAINT='destino_nao_fonte';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fontes_destino_guard BEFORE INSERT OR UPDATE ON fontes
  FOR EACH ROW EXECUTE FUNCTION proteger_destino_fonte();
CREATE TRIGGER config_destino_guard BEFORE UPDATE OF destino_whatsapp_jid ON config_nicho
  FOR EACH ROW EXECUTE FUNCTION proteger_destino_fonte();
CREATE INDEX mensagens_fonte_recente ON mensagens_brutas(fonte_id,recebida_em DESC);
