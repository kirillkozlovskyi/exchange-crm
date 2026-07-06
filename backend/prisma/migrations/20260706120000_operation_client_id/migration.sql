-- Офлайн-синк: clientId (uuid з фронта) робить створення операції ідемпотентним —
-- повторне надсилання після збою зв'язку не створює дубля.
ALTER TABLE "Operation" ADD COLUMN "clientId" TEXT;
CREATE UNIQUE INDEX "Operation_clientId_key" ON "Operation"("clientId");
