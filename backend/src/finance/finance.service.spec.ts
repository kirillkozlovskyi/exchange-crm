import { FinanceService } from './finance.service';

/**
 * Фінанси = сума реалізованого прибутку операцій ($-числовник: op.profitUsd
 * нативний, op.profit — ₴-знімок) + маржа USDT. Рахується при операції/закритті.
 */
const POINT = { id: 1, name: 'Точка 1' };
const shiftOf = { cashDesk: { exchangePoint: POINT } };

function makePrisma(ops: any[], usdtOps: any[] = []) {
  return {
    operation: { findMany: jest.fn().mockResolvedValue(ops) },
    usdtOperation: { findMany: jest.fn().mockResolvedValue(usdtOps) },
    rate: {
      findMany: jest.fn().mockResolvedValue([
        { exchangePointId: 1, currency: 'USD', buy: 41, sell: 41.5, status: 'ACTIVE' },
      ]),
    },
  };
}

describe('FinanceService — єдина модель прибутку', () => {
  it('прибуток = сума op.profit (₴-знімок) і op.profitUsd (нативний $)', async () => {
    // Відкуп 100 @41 проти бази 41.5 → +1.2 $ (50 ₴); продаж — 0.
    const ops = [
      { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, profit: 50, profitUsd: 1.2, cancelled: false, shift: shiftOf },
      { type: 'SELL', currency: 'USD', amount: 40, totalUah: 1660, profit: 0, profitUsd: 0, cancelled: false, shift: shiftOf },
    ];
    const service = new FinanceService(makePrisma(ops) as any, { sumByPoint: async () => ({}) } as any);

    const res = await service.getDailySummary();

    expect(res.totalProfit).toBeCloseTo(50);
    expect(res.totalProfitUsd).toBeCloseTo(1.2);
    expect(res.points[0].totalProfit).toBeCloseTo(50);
    expect(res.points[0].totalProfitUsd).toBeCloseTo(1.2);
    expect(res.points[0].operationsCount).toBe(2);
    expect(res.points[0].byCurrency.USD.volume).toBeCloseTo(140);
    expect(res.points[0].byCurrency.USD.profit).toBeCloseTo(50);
    expect(res.points[0].byCurrency.USD.profitUsd).toBeCloseTo(1.2);
  });

  it('маржа USDT входить окремим рядком (₴ і $)', async () => {
    const usdt = [
      { side: 'SELL', usdtAmount: 300, settleCurrency: 'UAH', settleAmount: 13500, profitUah: 120, profitUsd: 2.9, cashDesk: { exchangePoint: POINT } },
    ];
    const service = new FinanceService(makePrisma([], usdt) as any, { sumByPoint: async () => ({}) } as any);

    const res = await service.getDailySummary();

    expect(res.totalProfit).toBeCloseTo(120);
    expect(res.totalProfitUsd).toBeCloseTo(2.9);
    expect(res.points[0].byCurrency.USDT).toEqual({ volume: 300, profit: 120, profitUsd: 2.9 });
    expect(res.points[0].operationsCount).toBe(1);
  });

  it('сторновані операції відфільтровуються на рівні запиту', async () => {
    const prisma = makePrisma([]);
    const service = new FinanceService(prisma as any, { sumByPoint: async () => ({}) } as any);
    await service.getDailySummary();
    expect(prisma.operation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ cancelled: false }) }),
    );
  });
});
