-- CreateEnum
CREATE TYPE "UsdtSide" AS ENUM ('BUY', 'SELL');

-- CreateTable
CREATE TABLE "UsdtWallet" (
    "id" SERIAL NOT NULL,
    "exchangePointId" INTEGER NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "buyPct" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "sellPct" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsdtWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsdtOperation" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "side" "UsdtSide" NOT NULL,
    "usdtAmount" DECIMAL(18,4) NOT NULL,
    "pct" DECIMAL(8,4) NOT NULL,
    "usdValue" DECIMAL(18,4) NOT NULL,
    "settleCurrency" TEXT NOT NULL,
    "settleAmount" DECIMAL(15,2) NOT NULL,
    "settleRate" DECIMAL(15,6) NOT NULL,
    "profitUah" DECIMAL(15,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shiftId" INTEGER NOT NULL,
    "cashDeskId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,

    CONSTRAINT "UsdtOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UsdtWallet_exchangePointId_key" ON "UsdtWallet"("exchangePointId");

-- CreateIndex
CREATE UNIQUE INDEX "UsdtOperation_number_key" ON "UsdtOperation"("number");

-- AddForeignKey
ALTER TABLE "UsdtWallet" ADD CONSTRAINT "UsdtWallet_exchangePointId_fkey" FOREIGN KEY ("exchangePointId") REFERENCES "ExchangePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsdtOperation" ADD CONSTRAINT "UsdtOperation_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsdtOperation" ADD CONSTRAINT "UsdtOperation_cashDeskId_fkey" FOREIGN KEY ("cashDeskId") REFERENCES "CashDesk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsdtOperation" ADD CONSTRAINT "UsdtOperation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
