-- AlterTable: двовалютний своп (зустрічне плече передачі)
ALTER TABLE "Transfer" ADD COLUMN "counterCurrency" TEXT;
ALTER TABLE "Transfer" ADD COLUMN "counterAmount" DECIMAL(15,2);
