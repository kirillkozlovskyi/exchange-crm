import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertRate(
  exchangePointId: number,
  currency: string,
  buy: number,
  sell: number,
  userId: number,
) {
  const existing = await prisma.rate.findFirst({
    where: { exchangePointId, currency, status: 'ACTIVE' },
  });

  if (existing) {
    await prisma.rate.update({
      where: { id: existing.id },
      data: { buy, sell },
    });
  } else {
    await prisma.rate.create({
      data: {
        currency,
        buy,
        sell,
        exchangePointId,
        proposedById: userId,
        approvedById: userId,
      },
    });
  }
}

const DEFAULT_CURRENCIES = [
  { code: 'USD', name: 'Долар США' },
  { code: 'EUR', name: 'Євро' },
  { code: 'PLN', name: 'Польський злотий' },
  { code: 'GBP', name: 'Британський фунт' },
  { code: 'CHF', name: 'Швейцарський франк' },
  { code: 'CAD', name: 'Канадський долар' },
  { code: 'CZK', name: 'Чеська крона' },
];

async function main() {
  // Валюти
  for (const c of DEFAULT_CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: c.code },
      update: {},
      create: c,
    });
  }

  // Обмінні пункти
  const point1 = await prisma.exchangePoint.upsert({
    where: { code: 'T1' },
    update: {},
    create: { name: 'Точка 1', code: 'T1' },
  });

  const point2 = await prisma.exchangePoint.upsert({
    where: { code: 'T2' },
    update: {},
    create: { name: 'Точка 2', code: 'T2' },
  });

  // Каси
  await prisma.cashDesk.upsert({
    where: { id: 1 },
    update: {},
    create: { name: 'Каса №1', exchangePointId: point1.id },
  });

  await prisma.cashDesk.upsert({
    where: { id: 2 },
    update: {},
    create: { name: 'Каса №1', exchangePointId: point2.id },
  });

  await prisma.cashDesk.upsert({
    where: { id: 3 },
    update: {},
    create: { name: 'Каса №2', exchangePointId: point2.id },
  });

  const adminHash = await bcrypt.hash('admin123', 10);
  const cashierHash = await bcrypt.hash('cashier123', 10);

  const admin = await prisma.user.upsert({
    where: { login: 'admin' },
    update: {},
    create: {
      name: 'Адміністратор',
      login: 'admin',
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
  });

  await prisma.user.upsert({
    where: { login: 'cashier1' },
    update: {},
    create: {
      name: 'Касир Точка 1',
      login: 'cashier1',
      passwordHash: cashierHash,
      role: Role.CASHIER,
      exchangePointId: point1.id,
    },
  });

  await prisma.user.upsert({
    where: { login: 'cashier2' },
    update: {},
    create: {
      name: 'Касир Точка 2',
      login: 'cashier2',
      passwordHash: cashierHash,
      role: Role.CASHIER,
      exchangePointId: point2.id,
    },
  });

  // PointCurrency — валюти для кожної точки (USD, EUR, PLN для обох)
  const defaultPointCurrencies = ['USD', 'EUR', 'PLN', 'GBP', 'CHF'];
  for (const pointId of [point1.id, point2.id]) {
    for (const code of defaultPointCurrencies) {
      await prisma.pointCurrency.upsert({
        where: { exchangePointId_currencyCode: { exchangePointId: pointId, currencyCode: code } },
        update: {},
        create: { exchangePointId: pointId, currencyCode: code },
      });
    }
  }

  // Курси для Точки 1
  const rates1: [string, number, number][] = [
    ['USD', 41.00, 41.50],
    ['EUR', 44.00, 44.80],
    ['PLN', 10.20, 10.50],
    ['GBP', 51.00, 52.00],
    ['CHF', 46.00, 47.00],
    ['CAD', 30.00, 31.00],
    ['CZK', 1.70, 1.80],
  ];

  for (const [currency, buy, sell] of rates1) {
    await upsertRate(point1.id, currency, buy, sell, admin.id);
  }

  // Курси для Точки 2
  const rates2: [string, number, number][] = [
    ['USD', 41.10, 41.60],
    ['EUR', 44.10, 44.90],
    ['PLN', 10.15, 10.45],
    ['GBP', 51.10, 52.10],
    ['CHF', 46.10, 47.10],
    ['CAD', 30.10, 31.10],
    ['CZK', 1.72, 1.82],
  ];

  for (const [currency, buy, sell] of rates2) {
    await upsertRate(point2.id, currency, buy, sell, admin.id);
  }

  console.log('✅ Seed завершено');
  console.log('👤 Логіни: admin/admin123, cashier1/cashier123, cashier2/cashier123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
