-- CreateTable
CREATE TABLE "CashBankBalance" (
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashBankBalance_pkey" PRIMARY KEY ("currency")
);

-- CreateTable
CREATE TABLE "CashBankMovement" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "delta" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cashDeskId" INTEGER,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "CashBankMovement_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CashMovement" ADD COLUMN "counterparty" TEXT;

-- AddForeignKey
ALTER TABLE "CashBankMovement" ADD CONSTRAINT "CashBankMovement_cashDeskId_fkey" FOREIGN KEY ("cashDeskId") REFERENCES "CashDesk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashBankMovement" ADD CONSTRAINT "CashBankMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
