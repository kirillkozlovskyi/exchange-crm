-- Сторно USDT-операцій (як у валютних).
ALTER TABLE "UsdtOperation" ADD COLUMN "cancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UsdtOperation" ADD COLUMN "cancelNote" TEXT;
