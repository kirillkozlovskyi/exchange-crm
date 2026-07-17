-- Кастомний прибуток зміни від адміна (довідковий, поруч із системним).
ALTER TABLE "Shift" ADD COLUMN "adminProfitUsd" DECIMAL(15,2);
ALTER TABLE "Shift" ADD COLUMN "adminProfitUah" DECIMAL(15,2);
ALTER TABLE "Shift" ADD COLUMN "adminProfitNote" TEXT;
