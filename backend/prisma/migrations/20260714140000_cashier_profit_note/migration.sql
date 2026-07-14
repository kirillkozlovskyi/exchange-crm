-- Опис логіки підрахунку прибутку словами (необовʼязково) — поруч із
-- cashierProfit. Збираємо, щоб зрозуміти, як саме касири рахують заробіток.
ALTER TABLE "Operation" ADD COLUMN "cashierProfitNote" TEXT;
