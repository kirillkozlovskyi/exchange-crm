-- Звіт закриття зміни зберігається в БД: історичні звіти більше не залежать
-- від подальших змін курсів (раніше factualProfit/оцінка рахувались на льоту).
ALTER TABLE "Shift" ADD COLUMN "factualProfit" DECIMAL(15,2);
ALTER TABLE "Shift" ADD COLUMN "profitByCurrency" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Shift" ADD COLUMN "valuationRates" JSONB NOT NULL DEFAULT '{}';
