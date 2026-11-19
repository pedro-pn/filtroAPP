-- Guarda das fichas de EPI assinadas (pilar 9.2 / LGPD art. 16, I).
--
-- A NR-6 (item 6.6.1, "h") exige registrar o fornecimento de EPI ao empregado; o
-- prazo de guarda adotado é de 20 anos (LGPD_COMPLIANCE.md). A API já não deixa
-- excluir nem alterar EPI assinado; esta trigger repete a regra no banco, para
-- scripts, SQL manual ou código futuro também não conseguirem.
--
-- Bloqueia, enquanto a entrega/assinatura tiver menos de 20 anos:
--   * DELETE de "EpiRecord" assinado e de "EpiSignatureRequest" assinada;
--   * UPDATE que apague ou troque a evidência (data, imagem, PDF e hashes da assinatura);
--   * TRUNCATE das duas tabelas.
-- Exceção documentada (deploy/PRODUCTION.md, "Guarda das fichas de EPI"):
--   SET LOCAL filtrovali.epi_history_override = '<motivo>';  -- dentro de uma transação
-- Usada pela anonimização da homologação, que roda numa cópia descartável.

CREATE OR REPLACE FUNCTION filtrovali_epi_history_override() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('filtrovali.epi_history_override', true), '') <> ''
$$;

CREATE OR REPLACE FUNCTION filtrovali_epi_record_history_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF filtrovali_epi_history_override() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF (OLD."signedAt" IS NOT NULL OR OLD."signatureImageDataUrl" IS NOT NULL)
     AND OLD."lendDate" > now() - interval '20 years' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'EPI_SIGNED_HISTORY_LOCKED: entrega de EPI assinada (%) deve ser guardada por 20 anos (NR-6); arquive o registro em vez de excluir.', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
       OR NEW."signatureImageDataUrl" IS DISTINCT FROM OLD."signatureImageDataUrl" THEN
      RAISE EXCEPTION 'EPI_SIGNED_HISTORY_LOCKED: a evidência de assinatura da entrega de EPI (%) não pode ser alterada (guarda de 20 anos, NR-6).', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION filtrovali_epi_request_history_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF filtrovali_epi_history_override() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF OLD."signedAt" IS NOT NULL AND OLD."signedAt" > now() - interval '20 years' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'EPI_SIGNED_HISTORY_LOCKED: solicitação de assinatura de EPI assinada (%) deve ser guardada por 20 anos (NR-6).', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
       OR NEW."signatureImageDataUrl" IS DISTINCT FROM OLD."signatureImageDataUrl"
       OR NEW."signatureImageHash" IS DISTINCT FROM OLD."signatureImageHash"
       OR NEW."signedPdfPath" IS DISTINCT FROM OLD."signedPdfPath"
       OR NEW."signedPdfHash" IS DISTINCT FROM OLD."signedPdfHash" THEN
      RAISE EXCEPTION 'EPI_SIGNED_HISTORY_LOCKED: a evidência da solicitação de assinatura de EPI (%) não pode ser alterada (guarda de 20 anos, NR-6).', OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION filtrovali_epi_truncate_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF filtrovali_epi_history_override() THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'EPI_SIGNED_HISTORY_LOCKED: TRUNCATE de % apagaria fichas de EPI com guarda de 20 anos (NR-6).', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS "EpiRecord_signed_history_guard" ON "EpiRecord";
CREATE TRIGGER "EpiRecord_signed_history_guard"
  BEFORE UPDATE OR DELETE ON "EpiRecord"
  FOR EACH ROW EXECUTE FUNCTION filtrovali_epi_record_history_guard();

DROP TRIGGER IF EXISTS "EpiSignatureRequest_signed_history_guard" ON "EpiSignatureRequest";
CREATE TRIGGER "EpiSignatureRequest_signed_history_guard"
  BEFORE UPDATE OR DELETE ON "EpiSignatureRequest"
  FOR EACH ROW EXECUTE FUNCTION filtrovali_epi_request_history_guard();

DROP TRIGGER IF EXISTS "EpiRecord_truncate_guard" ON "EpiRecord";
CREATE TRIGGER "EpiRecord_truncate_guard"
  BEFORE TRUNCATE ON "EpiRecord"
  FOR EACH STATEMENT EXECUTE FUNCTION filtrovali_epi_truncate_guard();

DROP TRIGGER IF EXISTS "EpiSignatureRequest_truncate_guard" ON "EpiSignatureRequest";
CREATE TRIGGER "EpiSignatureRequest_truncate_guard"
  BEFORE TRUNCATE ON "EpiSignatureRequest"
  FOR EACH STATEMENT EXECUTE FUNCTION filtrovali_epi_truncate_guard();
