-- CreateTable
CREATE TABLE "OperationEdit" (
    "id" SERIAL NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "prevAmount" DECIMAL(15,2) NOT NULL,
    "prevRate" DECIMAL(10,4) NOT NULL,
    "newAmount" DECIMAL(15,2) NOT NULL,
    "newRate" DECIMAL(10,4) NOT NULL,
    "operationId" INTEGER NOT NULL,
    "editedById" INTEGER NOT NULL,

    CONSTRAINT "OperationEdit_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OperationEdit" ADD CONSTRAINT "OperationEdit_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationEdit" ADD CONSTRAINT "OperationEdit_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
