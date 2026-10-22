-- Falhas operacionais pertencem ao sistema e não a um projeto específico.
ALTER TABLE "NotificationEvent" ALTER COLUMN "projectId" DROP NOT NULL;
