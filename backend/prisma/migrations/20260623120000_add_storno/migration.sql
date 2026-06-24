-- AddStornoToOperation
ALTER TABLE "Operation" ADD COLUMN "cancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Operation" ADD COLUMN "cancelNote" TEXT;
