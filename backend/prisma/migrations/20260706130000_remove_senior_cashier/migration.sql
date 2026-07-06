-- Прибираємо роль SENIOR_CASHIER. Наявних старших касирів переводимо у CASHIER,
-- потім перестворюємо enum Role без цього значення (Postgres не вміє DROP VALUE).

UPDATE "User" SET "role" = 'CASHIER' WHERE "role" = 'SENIOR_CASHIER';

ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('CASHIER', 'ADMIN');
ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'CASHIER';
DROP TYPE "Role_old";
