-- CreateTable
CREATE TABLE "Currency" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "PointCurrency" (
    "id" SERIAL NOT NULL,
    "exchangePointId" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,

    CONSTRAINT "PointCurrency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointCurrency_exchangePointId_currencyCode_key" ON "PointCurrency"("exchangePointId", "currencyCode");

-- AddForeignKey
ALTER TABLE "PointCurrency" ADD CONSTRAINT "PointCurrency_exchangePointId_fkey" FOREIGN KEY ("exchangePointId") REFERENCES "ExchangePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointCurrency" ADD CONSTRAINT "PointCurrency_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
