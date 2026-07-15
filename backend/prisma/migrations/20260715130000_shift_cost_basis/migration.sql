-- Середня собівартість по валютах на момент закриття зміни (курс для прибутку).
ALTER TABLE "Shift" ADD COLUMN "costBasis" JSONB NOT NULL DEFAULT '{}';
