import { UsdtService } from './usdt.service';

/**
 * Прибуток USDT — з ФАКТИЧНОЇ суми розрахунку проти бази 1:1, а не з поля «%».
 * Курси точки: USD buy 44 / sell 45 → mid 44.5.
 */
function makePrisma() {
  let created: any = null;
  const prisma: any = {
    shift: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1, status: 'OPEN', cashDeskId: 1, openedAt: new Date(),
        startBalance: { UAH: 1000000, USD: 10000 },
        operations: [], cashMovements: [], usdtOperations: [],
        cashDesk: { id: 1, exchangePointId: 1 },
      }),
    },
    usdtWallet: {
      upsert: jest.fn().mockResolvedValue({ balance: 100000 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    usdtGlobalWallet: {
      upsert: jest.fn().mockResolvedValue({ id: 1, balance: 100000 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rate: {
      findMany: jest.fn().mockResolvedValue([
        { currency: 'USD', buy: 44, sell: 45, status: 'ACTIVE' },
      ]),
    },
    setting: { findUnique: jest.fn().mockResolvedValue(null) }, // джерело → GLOBAL
    transfer: { findMany: jest.fn().mockResolvedValue([]) },
    usdtOperation: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }: any) => { created = data; return Promise.resolve({ id: 1, ...data }); }),
    },
    $transaction: jest.fn((arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
    getCreated: () => created,
  };
  return prisma;
}

describe('UsdtService — прибуток з факту', () => {
  it('продаж 300 USDT рівно за 300 USD (1:1) → маржа 0', async () => {
    const service = new UsdtService(makePrisma() as any);
    const op: any = await service.create(
      { shiftId: 1, side: 'SELL', usdtAmount: 300, settleCurrency: 'USD', settleAmount: 300, pct: 0 },
      7,
    );
    expect(Number(op.profitUah)).toBeCloseTo(0);
  });

  it('продаж 300 USDT за 305 USD (ручна сума, %=0) → маржа 5 USD × mid', async () => {
    const service = new UsdtService(makePrisma() as any);
    const op: any = await service.create(
      { shiftId: 1, side: 'SELL', usdtAmount: 300, settleCurrency: 'USD', settleAmount: 305, pct: 0 },
      7,
    );
    expect(Number(op.profitUah)).toBeCloseTo(5 * 44.5); // 222.5
  });

  it('купівля 300 USDT за 13 200 UAH (дешевше бази) → маржа з факту', async () => {
    // База 1:1: 300 USDT = 300 USD = 13 350 грн за mid 44.5. Каса віддала 13 200 →
    // заробила 150 грн (settleUsd = 13200/44.5 ≈ 296.63; маржа ≈ 3.37 USD × 44.5 = 150).
    const service = new UsdtService(makePrisma() as any);
    const op: any = await service.create(
      { shiftId: 1, side: 'BUY', usdtAmount: 300, settleCurrency: 'UAH', settleAmount: 13200, pct: 0 },
      7,
    );
    expect(Number(op.profitUah)).toBeCloseTo(150, 0);
  });

  it('поле «%» впливає лише на підказку суми, не на прибуток напряму', async () => {
    // %=2, але касир вручну вписав рівно 1:1 → прибуток 0, а не 2%.
    const service = new UsdtService(makePrisma() as any);
    const op: any = await service.create(
      { shiftId: 1, side: 'SELL', usdtAmount: 100, settleCurrency: 'USD', settleAmount: 100, pct: 2 },
      7,
    );
    expect(Number(op.profitUah)).toBeCloseTo(0);
  });
});
