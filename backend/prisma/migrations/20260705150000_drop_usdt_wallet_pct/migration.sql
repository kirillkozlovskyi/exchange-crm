-- «Мертві» комісії USDT-гаманця: поля лишились у БД, але ніщо їх не читало
-- (вікно USDT стартує з 0%, касир вводить % вручну). Прибираємо, щоб налаштування
-- не вводило в оману.
ALTER TABLE "UsdtWallet" DROP COLUMN IF EXISTS "buyPct";
ALTER TABLE "UsdtWallet" DROP COLUMN IF EXISTS "sellPct";
