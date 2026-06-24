-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- Seed default quick amounts
INSERT INTO "Setting" ("key", "value") VALUES ('quickAmounts', '[10, 20, 50, 100, 500]')
ON CONFLICT ("key") DO NOTHING;
