import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Видаляємо в правильному порядку (foreign keys)
  await prisma.operation.deleteMany({});
  await prisma.transfer.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.cashDesk.deleteMany({});
  await prisma.rate.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.pointCurrency.deleteMany({});

  // Від'єднуємо користувачів від точок перед видаленням
  await prisma.user.updateMany({
    where: { role: { not: 'ADMIN' } },
    data: { exchangePointId: null },
  });

  // Видаляємо всіх користувачів крім адміна
  await prisma.user.deleteMany({ where: { role: { not: 'ADMIN' } } });

  // Видаляємо всі точки
  await prisma.exchangePoint.deleteMany({});

  console.log('✅ Очищено: точки, каси, зміни, операції, користувачі (крім адміна)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
