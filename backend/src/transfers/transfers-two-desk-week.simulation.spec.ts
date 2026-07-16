import { shiftCashBalance, confirmedTransfersNetForDesk } from '../common/shift-ledger.util';

/**
 * Симуляція тижня роботи ДВОХ кас із передачами між ними.
 *
 * Головне, що перевіряємо (те, про що просив замовник): коли між касами йдуть
 * передачі, баланс КОЖНОЇ з них має порахуватись правильно, а гроші компанії в
 * сумі — зберегтись. Передача — це не торгівля й не поява/зникнення грошей, а
 * переміщення: скільки пішло з каси-відправника, стільки прийшло на касу-
 * отримувача. Тому діють два незалежні інваріанти:
 *
 *   1) ДЗЕРКАЛЬНІСТЬ: нетто передач каси A по кожній валюті == −(нетто каси B).
 *   2) ЗБЕРЕЖЕННЯ: Σ(баланс A + баланс B) == Σ(старт + операції + рух готівки +
 *      USDT-готівка) БЕЗ передач — тобто передачі в сумі скорочуються й не
 *      зрушують загальний баланс компанії ні на копійку.
 *
 * Розрахунок балансу й нетто передач ведеться РЕАЛЬНИМИ продакшн-утилітами
 * (shiftCashBalance, confirmedTransfersNetForDesk) — тими самими, що використовує
 * TransfersService і закриття зміни. Якщо в них зламається знак чи плече свопу —
 * цей тест впаде.
 */

const DESK_A = 1; // точка «Центр»
const DESK_B = 2; // точка «Вокзал»

// Спільна для обох кас точка відліку: усі передачі підтверджені ПІСЛЯ відкриття.
const OPENED_AT = new Date(Date.UTC(2026, 6, 6, 8, 0, 0));
const at = (dayOffset: number) => new Date(OPENED_AT.getTime() + dayOffset * 86_400_000);

type Tr = {
  currency: string; amount: number;
  fromDeskId: number; toDeskId: number;
  counterCurrency?: string | null; counterAmount?: number | null;
  status: 'CONFIRMED' | 'PENDING' | 'REJECTED';
  confirmedAt: Date | null;
};

// Тижневий журнал передач між касами A і B.
const TRANSFERS: Tr[] = [
  // ПН: A підкидає B готівкові долари.
  { currency: 'USD', amount: 1000, fromDeskId: DESK_A, toDeskId: DESK_B,
    status: 'CONFIRMED', confirmedAt: at(0) },
  // ВТ: B повертає A євро.
  { currency: 'EUR', amount: 500, fromDeskId: DESK_B, toDeskId: DESK_A,
    status: 'CONFIRMED', confirmedAt: at(1) },
  // СР: своп — A віддає 2000 USD, отримує 1800 EUR (B — навпаки).
  { currency: 'USD', amount: 2000, fromDeskId: DESK_A, toDeskId: DESK_B,
    counterCurrency: 'EUR', counterAmount: 1800, status: 'CONFIRMED', confirmedAt: at(2) },
  // ЧТ: A відправила B 3000 USD, але каса-отримувач ще не підтвердила —
  // PENDING резервує готівку у відправника, але балансу НЕ рухає.
  { currency: 'USD', amount: 3000, fromDeskId: DESK_A, toDeskId: DESK_B,
    status: 'PENDING', confirmedAt: null },
  // ПТ: B відправила A 700 USD, отримувач відхилив — REJECTED не рухає нічого.
  { currency: 'USD', amount: 700, fromDeskId: DESK_B, toDeskId: DESK_A,
    status: 'REJECTED', confirmedAt: null },
];

// Мок Prisma, який чесно виконує той самий where-фільтр, що й продакшн-запит
// confirmedTransferRowsForDesk (status=CONFIRMED, confirmedAt у межах, каса в
// fromDesk|toDesk). Так тестуємо саме реальну вибірку, а не спрощену імітацію.
function transferDb(rows: Tr[]) {
  return {
    transfer: {
      findMany: async ({ where }: any) => {
        const deskId: number = where.OR[0].fromDeskId ?? where.OR[1].toDeskId;
        return rows.filter((t) => {
          if (where.status && t.status !== where.status) return false;
          if (t.fromDeskId !== deskId && t.toDeskId !== deskId) return false;
          const c = t.confirmedAt;
          if (where.confirmedAt?.gte && (!c || c < where.confirmedAt.gte)) return false;
          if (where.confirmedAt?.lte && (!c || c > where.confirmedAt.lte)) return false;
          return true;
        });
      },
    },
  };
}

// Тижневі документи кожної каси (без передач — вони окремо).
const DESK_A_PARTS = {
  startBalance: { UAH: 200_000, USD: 10_000, EUR: 5_000 },
  operations: [
    { type: 'BUY', currency: 'USD', amount: 2000, totalUah: 88_000, cancelled: false },   // +2000 USD, −88000 UAH
    { type: 'SELL', currency: 'EUR', amount: 1000, totalUah: 51_800, cancelled: false },   // −1000 EUR, +51800 UAH
  ],
  cashMovements: [{ direction: 'IN', currency: 'UAH', amount: 50_000 }],                    // підкріплення
  usdtOperations: [{ side: 'SELL', settleCurrency: 'UAH', settleAmount: 22_300, cancelled: false }], // +22300 UAH
};

const DESK_B_PARTS = {
  startBalance: { UAH: 150_000, USD: 4_000, EUR: 2_000 },
  operations: [
    { type: 'SELL', currency: 'USD', amount: 1500, totalUah: 66_900, cancelled: false },   // −1500 USD, +66900 UAH
    { type: 'BUY', currency: 'EUR', amount: 800, totalUah: 40_800, cancelled: false },      // +800 EUR, −40800 UAH
  ],
  cashMovements: [{ direction: 'OUT', currency: 'UAH', amount: 30_000 }],                    // інкасація
  usdtOperations: [{ side: 'BUY', settleCurrency: 'UAH', settleAmount: 11_150, cancelled: false }],  // −11150 UAH
};

const round = (b: Record<string, number>) => {
  const r: Record<string, number> = {};
  for (const [k, v] of Object.entries(b)) r[k] = Math.round(v * 100) / 100;
  return r;
};
const sumByCur = (...bals: Record<string, number>[]) => {
  const s: Record<string, number> = {};
  for (const b of bals) for (const [k, v] of Object.entries(b)) s[k] = (s[k] ?? 0) + v;
  return round(s);
};

describe('Тиждень двох кас із передачами між ними', () => {
  const db = transferDb(TRANSFERS);

  it('нетто передач кас A і B дзеркальні (що пішло — те й прийшло)', async () => {
    const netA = await confirmedTransfersNetForDesk(db as any, DESK_A, OPENED_AT);
    const netB = await confirmedTransfersNetForDesk(db as any, DESK_B, OPENED_AT);

    // A: −1000 USD (ПН) − 2000 USD (своп) = −3000; +500 EUR (ВТ) + 1800 EUR (своп) = +2300
    expect(round(netA)).toEqual({ USD: -3000, EUR: 2300 });
    // B — точне дзеркало A.
    expect(round(netB)).toEqual({ USD: 3000, EUR: -2300 });
    for (const cur of ['USD', 'EUR']) expect(netA[cur]).toBe(-netB[cur]);
  });

  it('PENDING/REJECTED не потрапляють у нетто (балансу не рухають)', async () => {
    const netA = await confirmedTransfersNetForDesk(db as any, DESK_A, OPENED_AT);
    // Якби PENDING 3000 USD (ЧТ) чи REJECTED 700 USD (ПТ) враховувались —
    // USD-нетто A було б не −3000. Значить, рахуються лише CONFIRMED.
    expect(round(netA).USD).toBe(-3000);
  });

  it('баланс КОЖНОЇ каси = старт + документи + нетто підтверджених передач', async () => {
    const netA = await confirmedTransfersNetForDesk(db as any, DESK_A, OPENED_AT);
    const netB = await confirmedTransfersNetForDesk(db as any, DESK_B, OPENED_AT);
    const balA = round(shiftCashBalance(DESK_A_PARTS as any, netA));
    const balB = round(shiftCashBalance(DESK_B_PARTS as any, netB));

    // Каса A:
    //   UAH 200000 −88000 +51800 +50000 +22300 = 236100
    //   USD 10000 +2000 −3000(передачі) = 9000
    //   EUR 5000 −1000 +2300(передачі) = 6300
    expect(balA).toEqual({ UAH: 236_100, USD: 9_000, EUR: 6_300 });
    // Каса B:
    //   UAH 150000 +66900 −40800 −30000 −11150 = 134950
    //   USD 4000 −1500 +3000(передачі) = 5500
    //   EUR 2000 +800 −2300(передачі) = 500
    expect(balB).toEqual({ UAH: 134_950, USD: 5_500, EUR: 500 });
  });

  it('ІНВАРІАНТ ЗБЕРЕЖЕННЯ: передачі перерозподіляють, але не змінюють Σ по компанії', async () => {
    const netA = await confirmedTransfersNetForDesk(db as any, DESK_A, OPENED_AT);
    const netB = await confirmedTransfersNetForDesk(db as any, DESK_B, OPENED_AT);

    // Реальні баланси кас (з передачами).
    const balA = shiftCashBalance(DESK_A_PARTS as any, netA);
    const balB = shiftCashBalance(DESK_B_PARTS as any, netB);
    const withTransfers = sumByCur(balA, balB);

    // Гіпотетичні баланси, якби передач не було зовсім ({} як нетто).
    const balA0 = shiftCashBalance(DESK_A_PARTS as any, {});
    const balB0 = shiftCashBalance(DESK_B_PARTS as any, {});
    const withoutTransfers = sumByCur(balA0, balB0);

    // Сумарний баланс компанії однаковий у обох світах: передача не створює й не
    // губить грошей — вона лише переносить їх з однієї каси в іншу.
    expect(withTransfers).toEqual(withoutTransfers);
    expect(withTransfers).toEqual({ UAH: 371_050, USD: 14_500, EUR: 6_800 });
  });
});
