-- API Playground e credenciais próprias de integração (migração aditiva).
CREATE TYPE "ApiProjectAccessMode" AS ENUM ('ALL', 'SELECTED');
CREATE TYPE "ApiUsageWindowKind" AS ENUM ('MINUTE', 'DAY');
CREATE TYPE "ApiCredentialEventType" AS ENUM ('CREATED', 'SECRET_REVEALED', 'METADATA_UPDATED', 'RESTRICTIONS_REDUCED', 'SCOPE_REDUCTION', 'PRIVILEGE_INCREASE_REJECTED', 'TESTED', 'ROTATED', 'REVOKED', 'EXPIRED_NOTICE');

CREATE TABLE "ApiCredential" (
  "id" TEXT NOT NULL,
  "selector" TEXT NOT NULL,
  "secretVerifier" TEXT NOT NULL,
  "hashKeyVersion" INTEGER NOT NULL,
  "secretLastFour" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL,
  "recipientContact" TEXT,
  "description" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "neverExpiresConfirmedAt" TIMESTAMP(3),
  "projectAccessMode" "ApiProjectAccessMode" NOT NULL,
  "allowedIpCidrs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allowedFormats" TEXT[] NOT NULL DEFAULT ARRAY['JSON']::TEXT[],
  "requestsPerMinute" INTEGER NOT NULL DEFAULT 60,
  "requestsPerDay" INTEGER NOT NULL DEFAULT 10000,
  "rowsPerDay" INTEGER NOT NULL DEFAULT 500000,
  "maxPageSize" INTEGER NOT NULL DEFAULT 100,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  "revocationReason" TEXT,
  "rotatedFromId" TEXT,
  "overlapEndsAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "issuanceRequestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiCredentialScope" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "scopeCode" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "grantedByUserId" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  CONSTRAINT "ApiCredentialScope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiCredentialProject" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "grantedByUserId" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  CONSTRAINT "ApiCredentialProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiCredentialEvent" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "type" "ApiCredentialEventType" NOT NULL,
  "reason" TEXT,
  "summary" JSONB NOT NULL DEFAULT '{}',
  "requestId" TEXT,
  "actorIp" TEXT,
  "actorUserAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiCredentialEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiRequestLog" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "scopeCode" TEXT NOT NULL,
  "pathTemplate" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "outcomeCode" TEXT NOT NULL,
  "responseRows" INTEGER NOT NULL DEFAULT 0,
  "responseBytes" INTEGER NOT NULL DEFAULT 0,
  "durationMs" INTEGER NOT NULL,
  "clientIp" TEXT,
  "userAgent" TEXT,
  "filterSummary" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApiUsageBucket" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "windowKind" "ApiUsageWindowKind" NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "rows" INTEGER NOT NULL DEFAULT 0,
  "bytes" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiUsageBucket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiCredential_selector_key" ON "ApiCredential"("selector");
CREATE UNIQUE INDEX "ApiCredential_rotatedFromId_key" ON "ApiCredential"("rotatedFromId");
CREATE UNIQUE INDEX "ApiCredential_issuanceRequestId_key" ON "ApiCredential"("issuanceRequestId");
CREATE INDEX "ApiCredential_revokedAt_expiresAt_idx" ON "ApiCredential"("revokedAt", "expiresAt");
CREATE INDEX "ApiCredential_createdByUserId_idx" ON "ApiCredential"("createdByUserId");
CREATE INDEX "ApiCredential_lastUsedAt_idx" ON "ApiCredential"("lastUsedAt");
CREATE INDEX "ApiCredential_name_idx" ON "ApiCredential"("name");
CREATE INDEX "ApiCredential_recipientName_idx" ON "ApiCredential"("recipientName");
CREATE UNIQUE INDEX "ApiCredentialScope_credentialId_scopeCode_key" ON "ApiCredentialScope"("credentialId", "scopeCode");
CREATE INDEX "ApiCredentialScope_credentialId_revokedAt_idx" ON "ApiCredentialScope"("credentialId", "revokedAt");
CREATE INDEX "ApiCredentialScope_scopeCode_revokedAt_idx" ON "ApiCredentialScope"("scopeCode", "revokedAt");
CREATE UNIQUE INDEX "ApiCredentialProject_credentialId_projectId_key" ON "ApiCredentialProject"("credentialId", "projectId");
CREATE INDEX "ApiCredentialProject_credentialId_revokedAt_idx" ON "ApiCredentialProject"("credentialId", "revokedAt");
CREATE INDEX "ApiCredentialProject_projectId_revokedAt_idx" ON "ApiCredentialProject"("projectId", "revokedAt");
CREATE UNIQUE INDEX "ApiCredentialEvent_requestId_key" ON "ApiCredentialEvent"("requestId");
CREATE INDEX "ApiCredentialEvent_credentialId_createdAt_idx" ON "ApiCredentialEvent"("credentialId", "createdAt");
CREATE INDEX "ApiCredentialEvent_type_createdAt_idx" ON "ApiCredentialEvent"("type", "createdAt");
CREATE UNIQUE INDEX "ApiRequestLog_requestId_key" ON "ApiRequestLog"("requestId");
CREATE INDEX "ApiRequestLog_credentialId_createdAt_idx" ON "ApiRequestLog"("credentialId", "createdAt");
CREATE INDEX "ApiRequestLog_operationId_createdAt_idx" ON "ApiRequestLog"("operationId", "createdAt");
CREATE INDEX "ApiRequestLog_statusCode_createdAt_idx" ON "ApiRequestLog"("statusCode", "createdAt");
CREATE INDEX "ApiRequestLog_createdAt_idx" ON "ApiRequestLog"("createdAt");
CREATE UNIQUE INDEX "ApiUsageBucket_credentialId_windowKind_windowStart_key" ON "ApiUsageBucket"("credentialId", "windowKind", "windowStart");
CREATE INDEX "ApiUsageBucket_windowKind_windowStart_idx" ON "ApiUsageBucket"("windowKind", "windowStart");
CREATE INDEX "ApiUsageBucket_updatedAt_idx" ON "ApiUsageBucket"("updatedAt");
CREATE INDEX "QualityRecord_updatedAt_id_idx" ON "QualityRecord"("updatedAt", "id");
CREATE INDEX "QualityRecord_deletedAt_updatedAt_id_idx" ON "QualityRecord"("deletedAt", "updatedAt", "id");

ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_rotatedFromId_fkey" FOREIGN KEY ("rotatedFromId") REFERENCES "ApiCredential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialScope" ADD CONSTRAINT "ApiCredentialScope_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialScope" ADD CONSTRAINT "ApiCredentialScope_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialScope" ADD CONSTRAINT "ApiCredentialScope_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialProject" ADD CONSTRAINT "ApiCredentialProject_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialProject" ADD CONSTRAINT "ApiCredentialProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialProject" ADD CONSTRAINT "ApiCredentialProject_grantedByUserId_fkey" FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialProject" ADD CONSTRAINT "ApiCredentialProject_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialEvent" ADD CONSTRAINT "ApiCredentialEvent_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiCredentialEvent" ADD CONSTRAINT "ApiCredentialEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ApiRequestLog" ADD CONSTRAINT "ApiRequestLog_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApiUsageBucket" ADD CONSTRAINT "ApiUsageBucket_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
