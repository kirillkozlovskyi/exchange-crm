-- Грошова цілісність: унікальні часткові індекси.

-- 1) Лише один ACTIVE-курс на точку+валюту. Спершу деактивуємо дублікати
--    (лишаємо найновіший за createdAt, при рівності — з більшим id).
UPDATE "Rate" r SET status = 'INACTIVE'
WHERE r.status = 'ACTIVE' AND EXISTS (
  SELECT 1 FROM "Rate" r2
  WHERE r2."exchangePointId" = r."exchangePointId"
    AND r2.currency = r.currency
    AND r2.status = 'ACTIVE'
    AND (r2."createdAt" > r."createdAt" OR (r2."createdAt" = r."createdAt" AND r2.id > r.id))
);

CREATE UNIQUE INDEX IF NOT EXISTS "Rate_point_currency_active_key"
  ON "Rate"("exchangePointId", "currency") WHERE status = 'ACTIVE';

-- 2) Лише одна OPEN-зміна на касу (захист від гонки подвійного відкриття).
CREATE UNIQUE INDEX IF NOT EXISTS "Shift_desk_open_key"
  ON "Shift"("cashDeskId") WHERE status = 'OPEN';
