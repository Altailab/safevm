-- CreateTable
CREATE TABLE "Setting" (
    "tenantId" TEXT NOT NULL DEFAULT 'default',
    "publicDomain" TEXT,
    "tlsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "setupDone" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("tenantId")
);
