-- Шапка чека на рівні точки: назва для друку та телефон (обидва необов'язкові)
ALTER TABLE "ExchangePoint" ADD COLUMN "receiptName" TEXT;
ALTER TABLE "ExchangePoint" ADD COLUMN "phone" TEXT;
