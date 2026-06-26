-- Дата-міграція: конвертація старих записів Купівлі у симетричний формат.
--
-- Було (класичний BUY):  currency='UAH', amount=<сума валюти>,
--                        payCurrency=<валюта>, payAmount=<сума валюти>
-- Стало:                 currency=<валюта>,  amount=<сума валюти>,
--                        payCurrency=NULL,    payAmount=NULL
--
-- Це лагодить і відображення в списку операцій (раніше їх плутали з крос-курсами),
-- і розрахунок балансу каси. totalUah/rate/profit не змінюються.
--
-- Зачіпає лише класичні BUY (currency='UAH' + є payCurrency). Нові BUY
-- (currency=валюта, payCurrency=NULL), крос (currency=валюта) та SELL не підпадають.
UPDATE "Operation"
SET "currency"    = "payCurrency",
    "amount"      = COALESCE("payAmount", "amount"),
    "payCurrency" = NULL,
    "payAmount"   = NULL
WHERE "type" = 'BUY'
  AND "currency" = 'UAH'
  AND "payCurrency" IS NOT NULL;
