CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
CREATE INDEX IF NOT EXISTS "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");
CREATE INDEX IF NOT EXISTS "SatisfactionSurvey_respondedAt_idx" ON "SatisfactionSurvey"("respondedAt");
CREATE INDEX IF NOT EXISTS "ReportDraft_updatedAt_idx" ON "ReportDraft"("updatedAt");
