-- Примусова зміна пароля при першому вході.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- Наявний дефолтний адмін (логін 'admin') має змінити пароль admin123.
UPDATE "User" SET "mustChangePassword" = true WHERE "login" = 'admin';
