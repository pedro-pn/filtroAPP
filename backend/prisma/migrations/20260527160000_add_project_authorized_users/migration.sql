CREATE TABLE "ProjectAuthorizedUser" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAuthorizedUser_pkey" PRIMARY KEY ("projectId","userId")
);

CREATE INDEX "ProjectAuthorizedUser_userId_idx" ON "ProjectAuthorizedUser"("userId");

ALTER TABLE "ProjectAuthorizedUser"
    ADD CONSTRAINT "ProjectAuthorizedUser_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectAuthorizedUser"
    ADD CONSTRAINT "ProjectAuthorizedUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
