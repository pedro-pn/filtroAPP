-- Preserve the existing policy; administrators can change the complete matrix.
INSERT INTO "EfetivoSetting" (key, "numberValue", "textValue", "updatedAt")
VALUES ('workforce.visibility.v1', 1,
  '{"RDO":["OPERATIONAL"],"EFETIVO":["OPERATIONAL"],"ALLOCATION_REVIEW":["OPERATIONAL"],"PRODUCTIVITY":["OPERATIONAL"],"ACOMPANHAMENTO":["OPERATIONAL"],"EQUIPMENT":["OPERATIONAL"],"ROMANEIO":["OPERATIONAL"],"API":["OPERATIONAL"],"EPI":["OPERATIONAL","NON_OPERATIONAL","PENDING"]}',
  CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;
