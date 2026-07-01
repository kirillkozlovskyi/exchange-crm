-- CreateTable
CREATE TABLE "UsdtGlobalWallet" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsdtGlobalWallet_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "UsdtOperation" ADD COLUMN "walletSource" TEXT NOT NULL DEFAULT 'POINT';
