ALTER TABLE "Collaborator"
  ADD COLUMN "cpf" TEXT,
  ADD COLUMN "registrationNumber" TEXT,
  ADD COLUMN "admissionDate" TIMESTAMP(3);

CREATE TABLE "EpiCatalogItem" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ca" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpiCatalogItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EpiSignatureRequest" (
  "id" TEXT NOT NULL,
  "collaboratorId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "signedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpiSignatureRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EpiRecord" (
  "id" TEXT NOT NULL,
  "collaboratorId" TEXT NOT NULL,
  "catalogItemId" TEXT,
  "epiName" TEXT NOT NULL,
  "ca" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "lendDate" TIMESTAMP(3) NOT NULL,
  "devolutionDate" TIMESTAMP(3),
  "signatureRequestId" TEXT,
  "signatureImageDataUrl" TEXT,
  "signatureSignerName" TEXT,
  "signedAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpiRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EpiCatalogItem_name_ca_key" ON "EpiCatalogItem"("name", "ca");
CREATE INDEX "EpiCatalogItem_isActive_idx" ON "EpiCatalogItem"("isActive");
CREATE INDEX "EpiCatalogItem_name_idx" ON "EpiCatalogItem"("name");
CREATE UNIQUE INDEX "EpiSignatureRequest_tokenHash_key" ON "EpiSignatureRequest"("tokenHash");
CREATE INDEX "EpiSignatureRequest_collaboratorId_idx" ON "EpiSignatureRequest"("collaboratorId");
CREATE INDEX "EpiSignatureRequest_status_idx" ON "EpiSignatureRequest"("status");
CREATE INDEX "EpiSignatureRequest_expiresAt_idx" ON "EpiSignatureRequest"("expiresAt");
CREATE INDEX "EpiRecord_collaboratorId_idx" ON "EpiRecord"("collaboratorId");
CREATE INDEX "EpiRecord_catalogItemId_idx" ON "EpiRecord"("catalogItemId");
CREATE INDEX "EpiRecord_signatureRequestId_idx" ON "EpiRecord"("signatureRequestId");
CREATE INDEX "EpiRecord_signedAt_idx" ON "EpiRecord"("signedAt");

ALTER TABLE "EpiSignatureRequest"
  ADD CONSTRAINT "EpiSignatureRequest_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EpiSignatureRequest_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EpiRecord"
  ADD CONSTRAINT "EpiRecord_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "Collaborator"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EpiRecord_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "EpiCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EpiRecord_signatureRequestId_fkey" FOREIGN KEY ("signatureRequestId") REFERENCES "EpiSignatureRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EpiRecord_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
