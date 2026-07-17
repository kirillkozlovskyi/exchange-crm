/**
 * ТИМЧАСОВИЙ скрипт (локальна перевірка $-числовника): повністю чистить
 * локальну БД і відтворює ДВІ продові зміни зі скачаних звітів —
 * КО-20260716-57 (каса 2, Вікторія) та Т2-20260716-58 (каса 4, Света/Назар) —
 * з усіма операціями, рухами готівки, USDT і передачами. Після імпорту
 * рестарт бекенду запускає $-беквіл → можна порівняти прибутки зі старими
 * гривневими у звітах (57: 8561.09 ₴, 58: 5870.87 ₴).
 *
 * Запуск (повна чистка + імпорт):
 *   CONFIRM_IMPORT=1 WIPE=1 DATABASE_URL=... npx ts-node prisma/import-prod-shifts.ts <звіт.json> ...
 * Дозапис нових змін до наявних (без чистки; довідники доствворюються):
 *   CONFIRM_IMPORT=1 DATABASE_URL=... npx ts-node prisma/import-prod-shifts.ts <звіт.json> ...
 * Наприкінці скидає прапорець usd_backfill_done — наступний рестарт бекенду
 * перерахує ВСЮ історію (беквіл ідемпотентний).
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as fs from 'fs';

const prisma = new PrismaClient();

const DEFAULT_REPORTS = [
  '/Users/kirillkozlovskyi/Downloads/zvit-zmina-КО-20260716-57.json',
  '/Users/kirillkozlovskyi/Downloads/zvit-zmina-Т2-20260716-58 (1).json',
];
const REPORTS = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_REPORTS;

const CURRENCY_NAMES: Record<string, string> = {
  USD: 'Долар США', EUR: 'Євро', PLN: 'Польський злотий', GBP: 'Британський фунт',
  CHF: 'Швейцарський франк', CAD: 'Канадський долар', CZK: 'Чеська крона',
  USDG: 'Долар (білий)', USDW: 'Долар (ветош)', USDT: 'USDT',
};

async function wipeAll() {
  // FK-безпечний порядок.
  await prisma.operationEdit.deleteMany({});
  await prisma.operation.deleteMany({});
  await prisma.reconciliation.deleteMany({});
  await prisma.cashMovement.deleteMany({});
  await prisma.usdtOperation.deleteMany({});
  await prisma.transfer.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.cashBankMovement.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.rate.deleteMany({});
  await prisma.deskCostBasis.deleteMany({});
  await prisma.pointCurrency.deleteMany({});
  await prisma.usdtWallet.deleteMany({});
  await prisma.usdtGlobalWallet.deleteMany({});
  await prisma.cashBankBalance.deleteMany({});
  await prisma.setting.deleteMany({}); // разом із usd_backfill_done → беквіл виконається
  await prisma.user.deleteMany({});
  await prisma.cashDesk.deleteMany({});
  await prisma.exchangePoint.deleteMany({});
  await prisma.currency.deleteMany({});
}

async function main() {
  if (process.env.CONFIRM_IMPORT !== '1') {
    console.error('Захист: постав CONFIRM_IMPORT=1, щоб стерти локальну БД і імпортувати зміни.');
    process.exit(1);
  }
  const reports = REPORTS.map((p) => JSON.parse(fs.readFileSync(p, 'utf8')));

  if (process.env.WIPE === '1') {
    console.log('Чищу локальну БД…');
    await wipeAll();
  } else {
    console.log('Режим дозапису (без чистки).');
  }

  // ── Довідники ──────────────────────────────────────────────────────────────
  const points = new Map<number, any>();
  const desks = new Map<number, any>();
  const users = new Map<number, any>();
  const currencies = new Set<string>(['UAH']);

  for (const d of reports) {
    const p = d.shift.cashDesk.exchangePoint;
    points.set(p.id, p);
    desks.set(d.shift.cashDesk.id, d.shift.cashDesk);
    users.set(d.shift.openedBy.id, { ...d.shift.openedBy, pointId: p.id });
    for (const op of d.operations) users.set(op.cashier.id, { ...op.cashier, pointId: p.id });
    for (const t of d.transfers) {
      for (const who of [t.sentBy, t.confirmedBy]) {
        if (who && !users.has(who.id)) users.set(who.id, { ...who, pointId: p.id });
      }
    }
    for (const r of d.activeRates) currencies.add(r.currency);
    for (const [cur] of Object.entries(d.shift.startBalance)) currencies.add(cur);
    // Каси з передач (можуть посилатись на іншу касу тієї ж/іншої точки).
    for (const t of d.transfers) {
      for (const side of [t.fromDesk, t.toDesk]) {
        if (side && !desks.has(side.id)) desks.set(side.id, { ...side, exchangePoint: p });
      }
    }
  }

  for (const cur of currencies) {
    if (cur === 'UAH') continue; // гривня — числова база, не рядок довідника
    await prisma.currency.upsert({
      where: { code: cur }, update: {},
      create: { code: cur, name: CURRENCY_NAMES[cur] ?? cur },
    });
  }
  for (const p of points.values()) {
    if (await prisma.exchangePoint.findUnique({ where: { id: p.id } })) continue;
    await prisma.exchangePoint.create({
      data: { id: p.id, name: p.name, code: p.code, address: p.address, createdAt: new Date(p.createdAt) },
    });
  }
  for (const dk of desks.values()) {
    if (await prisma.cashDesk.findUnique({ where: { id: dk.id } })) continue;
    const pointId = dk.exchangePointId ?? dk.exchangePoint?.id;
    await prisma.cashDesk.create({
      data: { id: dk.id, name: dk.name, active: true, exchangePointId: pointId },
    });
  }

  const adminHash = await bcrypt.hash('admin123', 10);
  const cashierHash = await bcrypt.hash('cashier123', 10);
  const admin =
    (await prisma.user.findUnique({ where: { login: 'admin' } })) ??
    (await prisma.user.create({
      data: { name: 'Адміністратор', login: 'admin', passwordHash: adminHash, role: Role.ADMIN },
    }));
  for (const u of users.values()) {
    if (await prisma.user.findUnique({ where: { id: u.id } })) continue;
    await prisma.user.create({
      data: {
        id: u.id, name: u.name, login: `cashier${u.id}`, passwordHash: cashierHash,
        role: Role.CASHIER, exchangePointId: u.pointId,
      },
    });
  }

  // Курси точок: створюємо зранку дня зміни (база таймлайну S — прибуток
  // рахується за курсом НА МОМЕНТ операції). Старі ACTIVE цієї точки, створені
  // раніше за цей ранок, деактивуємо — як робить rates.service при зміні курсу.
  for (const d of reports) {
    const pointId = d.shift.cashDesk.exchangePoint.id;
    const open = new Date(d.shift.openedAt);
    const rateMorning = new Date(Date.UTC(open.getUTCFullYear(), open.getUTCMonth(), open.getUTCDate(), 6, 0, 0));
    for (const r of d.activeRates) {
      await prisma.rate.updateMany({
        where: { exchangePointId: pointId, currency: r.currency, status: 'ACTIVE', createdAt: { lt: rateMorning } },
        data: { status: 'INACTIVE' },
      });
      const exists = await prisma.rate.findFirst({
        where: { exchangePointId: pointId, currency: r.currency, createdAt: rateMorning },
      });
      if (!exists) {
        await prisma.rate.create({
          data: {
            currency: r.currency, buy: Number(r.buy), sell: Number(r.sell), status: 'ACTIVE',
            createdAt: rateMorning, exchangePointId: pointId, proposedById: admin.id, approvedById: admin.id,
          },
        });
      }
      await prisma.pointCurrency.upsert({
        where: { exchangePointId_currencyCode: { exchangePointId: pointId, currencyCode: r.currency } },
        update: {},
        create: { exchangePointId: pointId, currencyCode: r.currency },
      }).catch(() => {});
    }
  }

  // Гаманці USDT (нульові — для порівняння прибутків баланс не важливий).
  await prisma.usdtGlobalWallet.upsert({ where: { id: 1 }, update: {}, create: { id: 1, balance: 0 } });
  for (const p of points.values()) {
    await prisma.usdtWallet.upsert({
      where: { exchangePointId: p.id }, update: {}, create: { exchangePointId: p.id, balance: 0 },
    });
  }

  // ── Зміни з документами ────────────────────────────────────────────────────
  const seenTransfers = new Set<string>(
    (await prisma.transfer.findMany({ select: { number: true } })).map((t) => t.number),
  );
  for (const d of reports) {
    const s = d.shift;
    if (await prisma.shift.findUnique({ where: { id: s.id } })) {
      console.log(`Зміна ${s.number} вже імпортована — пропускаю.`);
      continue;
    }
    await prisma.shift.create({
      data: {
        id: s.id, number: s.number, status: s.status,
        openedAt: new Date(s.openedAt), closedAt: s.closedAt ? new Date(s.closedAt) : null,
        startBalance: s.startBalance, endBalance: s.endBalance, calcBalance: s.calcBalance,
        // Старі гривневі підсумки — беквіл перепише їх у $-модель.
        profit: Number(s.profit ?? 0), factualProfit: s.factualProfit != null ? Number(s.factualProfit) : null,
        profitByCurrency: s.profitByCurrency ?? {}, valuationRates: s.valuationRates ?? {},
        costBasis: s.costBasis ?? {}, note: s.note,
        cashDeskId: s.cashDeskId, openedById: s.openedById,
      },
    });
    for (const op of d.operations) {
      await prisma.operation.create({
        data: {
          id: op.id, number: op.number, type: op.type, currency: op.currency,
          amount: Number(op.amount), rate: Number(op.rate), totalUah: Number(op.totalUah),
          profit: Number(op.profit ?? 0),
          cashierProfit: op.cashierProfit != null ? Number(op.cashierProfit) : null,
          cashierProfitCurrency: op.cashierProfitCurrency, cashierProfitNote: op.cashierProfitNote,
          note: op.note, createdAt: new Date(op.createdAt),
          cancelled: !!op.cancelled, cancelNote: op.cancelNote,
          payCurrency: op.payCurrency, payAmount: op.payAmount != null ? Number(op.payAmount) : null,
          shiftId: s.id, cashierId: op.cashierId ?? op.cashier.id,
        },
      });
    }
    for (const m of d.cashMovements) {
      await prisma.cashMovement.create({
        data: {
          id: m.id, number: m.number, direction: m.direction, currency: m.currency,
          amount: Number(m.amount), source: m.source, counterparty: m.counterparty, note: m.note,
          createdAt: new Date(m.createdAt), shiftId: s.id, cashDeskId: m.cashDeskId,
          createdById: m.createdById ?? m.createdBy.id,
        },
      });
    }
    for (const u of d.usdtOperations) {
      await prisma.usdtOperation.create({
        data: {
          id: u.id, number: u.number, side: u.side, walletSource: u.walletSource,
          usdtAmount: Number(u.usdtAmount), pct: Number(u.pct), usdValue: Number(u.usdValue),
          settleCurrency: u.settleCurrency, settleAmount: Number(u.settleAmount),
          settleRate: Number(u.settleRate), profitUah: Number(u.profitUah ?? 0),
          note: u.note, cancelled: !!u.cancelled, cancelNote: u.cancelNote,
          createdAt: new Date(u.createdAt), shiftId: s.id, cashDeskId: u.cashDeskId,
          createdById: u.createdById ?? u.createdBy.id,
        },
      });
    }
    for (const r of d.reconciliations) {
      await prisma.reconciliation.create({
        data: {
          id: r.id, createdAt: new Date(r.createdAt), expected: r.expected, actual: r.actual,
          hasDiscrepancy: !!r.hasDiscrepancy, note: r.note,
          shiftId: s.id, cashDeskId: r.cashDeskId, createdById: r.createdById ?? r.createdBy.id,
        },
      });
    }
    for (const t of d.transfers) {
      if (seenTransfers.has(t.number)) continue; // ті самі передачі є в обох звітах
      seenTransfers.add(t.number);
      await prisma.transfer.create({
        data: {
          id: t.id, number: t.number, currency: t.currency, amount: Number(t.amount),
          counterCurrency: t.counterCurrency, counterAmount: t.counterAmount != null ? Number(t.counterAmount) : null,
          status: 'CONFIRMED', note: t.note ?? null,
          createdAt: new Date(t.confirmedAt), confirmedAt: new Date(t.confirmedAt),
          fromDeskId: t.fromDesk.id, toDeskId: t.toDesk.id,
          sentById: t.sentBy?.id ?? admin.id,
          confirmedById: t.confirmedBy?.id ?? null,
        },
      });
    }
  }

  // Сиквенси — щоб нові записи не конфліктували з імпортованими id.
  for (const table of ['User', 'ExchangePoint', 'CashDesk', 'Shift', 'Operation', 'CashMovement', 'UsdtOperation', 'Transfer', 'Reconciliation', 'Rate']) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${table}"','id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`,
    );
  }

  // Скидаємо прапорець — наступний рестарт бекенду перерахує всю історію.
  await prisma.setting.deleteMany({ where: { key: 'usd_backfill_done' } });

  const counts = {
    shifts: await prisma.shift.count(), operations: await prisma.operation.count(),
    movements: await prisma.cashMovement.count(), usdt: await prisma.usdtOperation.count(),
    transfers: await prisma.transfer.count(), rates: await prisma.rate.count(),
  };
  console.log('У БД тепер:', counts);
  console.log('Логін: admin / admin123 (касири: cashierN / cashier123)');
  console.log('Тепер: docker compose restart backend → $-беквіл перерахує всі зміни.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
