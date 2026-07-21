-- Кешбек/Витрата: знімок впливу на прибуток зміни (₴/$) + категорія витрати
ALTER TABLE "CashMovement" ADD COLUMN "expenseCategory" TEXT;
ALTER TABLE "CashMovement" ADD COLUMN "profit" DECIMAL(15,2);
ALTER TABLE "CashMovement" ADD COLUMN "profitUsd" DECIMAL(18,6);
