-- Перехідна собівартість позиції каси по валюті (модель прибутку WAC).
CREATE TABLE "DeskCostBasis" (
  "cashDeskId" INTEGER NOT NULL,
  "currency"   TEXT NOT NULL,
  "avgCost"    DECIMAL(18,6) NOT NULL,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeskCostBasis_pkey" PRIMARY KEY ("cashDeskId", "currency")
);
