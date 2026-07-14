-- Показник «маржа з відкупу» (модель замовника): заробіток кільця
-- «продав валюту → відкупив її на виручену гривню». Додатковий до profit.

-- Пул проданої гривні, що чекає відкупу (переноситься між змінами каси).
CREATE TABLE "DeskSoldPool" (
  "cashDeskId" INTEGER NOT NULL,
  "currency"   TEXT NOT NULL,
  "units"      DECIMAL(18,4) NOT NULL,
  "uah"        DECIMAL(18,2) NOT NULL,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeskSoldPool_pkey" PRIMARY KEY ("cashDeskId", "currency")
);

-- Маржа зміни (зберігається при закритті, поруч із profit).
ALTER TABLE "Shift" ADD COLUMN "buybackMargin" DECIMAL(15,2);
ALTER TABLE "Shift" ADD COLUMN "buybackMarginByCurrency" JSONB NOT NULL DEFAULT '{}';
