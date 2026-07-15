-- Валюта прибутку, який касир порахував сам (за замовчуванням UAH).
ALTER TABLE "Operation" ADD COLUMN "cashierProfitCurrency" TEXT;
