import { FinanceService } from './finance.service';

/**
 * Фінанси = та сама модель прибутку, що й закриття зміни:
 * realizedProfit («з відкупу») + маржа USDT. Стара модель (Σ op.profit)
 * подвійно рахувала спред.
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
  it('прибуток = реалізований спред (як у закритті зміни), а не Σ op.profit', async () => {
    // Куплено 100 USD @41 (op.profit=50), продано 40 USD @41.5 (op.profit=20).
    // Стара модель дала б 70 (подвійний спред). Реалізовано: 40×(41.5−41)=20.
    const ops = [
      { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, profit: 50, cancelled: false, shift: shiftOf },
      { type: 'SELL', currency: 'USD', amount: 40, totalUah: 1660, profit: 20, cancelled: false, shift: shiftOf },
    ];
    const service = new FinanceService(makePrisma(ops) as any);

    const res = await service.getDailySummary();

    expect(res.totalProfit).toBeCloseTo(20);
    expect(res.points[0].totalProfit).toBeCloseTo(20);
    expect(res.points[0].operationsCount).toBe(2);
    expect(res.points[0].byCurrency.USD.volume).toBeCloseTo(140);
    expect(res.points[0].byCurrency.USD.profit).toBeCloseTo(20);
  });

  it('маржа USDT входить окремим рядком', async () => {
    const usdt = [
      { side: 'SELL', usdtAmount: 300, settleCurrency: 'UAH', settleAmount: 13500, profitUah: 120, cashDesk: { exchangePoint: POINT } },
    ];
    const service = new FinanceService(makePrisma([], usdt) as any);

    const res = await service.getDailySummary();

    expect(res.totalProfit).toBeCloseTo(120);
    expect(res.points[0].byCurrency.USDT).toEqual({ volume: 300, profit: 120 });
    expect(res.points[0].operationsCount).toBe(1);
  });

  it('сторновані операції відфільтровуються на рівні запиту', async () => {
    const prisma = makePrisma([]);
    const service = new FinanceService(prisma as any);
    await service.getDailySummary();
    expect(prisma.operation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ cancelled: false }) }),
    );
  });
});
