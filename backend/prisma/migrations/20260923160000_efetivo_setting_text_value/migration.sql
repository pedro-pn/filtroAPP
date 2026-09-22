-- Permite guardar valores de texto em EfetivoSetting (hoje só números), reaproveitado para a tela genérica de
-- e-mails de notificação por finalidade, na Administração do Efetivo.
ALTER TABLE "EfetivoSetting" ADD COLUMN "textValue" TEXT;
