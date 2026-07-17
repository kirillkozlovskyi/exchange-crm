-- Перехід ядра прибутку на $-числовник (модель «каса в доларах»):
-- нативний прибуток у доларах поруч із гривневими знімками.

-- Операції: profitUsd — нативний; profit лишається ₴-знімком.
ALTER TABLE "Operation" ADD COLUMN "profitUsd" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- USDT: маржа у $ (з факту проти 1:1); profitUah лишається.
ALTER TABLE "UsdtOperation" ADD COLUMN "profitUsd" DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Зміни: $-підсумки, знімок курсу продажу USD на закритті, «каса в доларах».
ALTER TABLE "Shift" ADD COLUMN "profitUsd" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "Shift" ADD COLUMN "factualProfitUsd" DECIMAL(15,2);
ALTER TABLE "Shift" ADD COLUMN "profitByCurrencyUsd" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Shift" ADD COLUMN "usdSellAtClose" DECIMAL(10,4);
ALTER TABLE "Shift" ADD COLUMN "tillUsd" JSONB NOT NULL DEFAULT '{}';

-- Стара модель «маржа з відкупу» видалена з коду: пул проданої гривні більше
-- не ведеться (колонки Shift.buybackMargin* лишаються для історії).
DROP TABLE IF EXISTS "DeskSoldPool";
