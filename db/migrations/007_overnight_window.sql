ALTER TABLE config_nicho DROP CONSTRAINT config_nicho_check1;
ALTER TABLE config_nicho ADD CONSTRAINT config_nicho_horarios_diferentes CHECK (horario_inicio <> horario_fim);
