import { realizedProfit } from './profit.util';

const mid = { UAH: 1, USD: 40, EUR: 43 };

describe('realizedProfit — реалізований спред «з відкупу»', () => {
  it('матчить min(куплено, продано) × (сер.продаж − сер.купівля)', () => {
    const ops = [
      // продано 5000 USD @ 40.10 (каса віддала USD, отримала UAH)
      { type: 'SELL', currency: 'USD', amount: 5000, totalUah: 200500 },
      // куплено 3000 USD @ 39.80 (каса отримала USD, віддала UAH)
      { type: 'BUY', currency: 'USD', amount: 3000, totalUah: 119400 },
    ];
    const { total, byCurrency } = realizedProfit(ops, mid);
    // відкуплено = min(5000,3000)=3000; 3000×(40.10−39.80)=900
    expect(byCurrency.USD).toBeCloseTo(900, 6);
    expect(total).toBeCloseTo(900, 6);
  });

  it('непокрита позиція не дає прибутку (лише продаж)', () => {
    const ops = [{ type: 'SELL', currency: 'USD', amount: 5000, totalUah: 200500 }];
    const { total } = realizedProfit(ops, mid);
    expect(total).toBeCloseTo(0, 6);
  });

  it('скасовані операції ігноруються', () => {
    const ops = [
      { type: 'SELL', currency: 'USD', amount: 5000, totalUah: 200500 },
      { type: 'BUY', currency: 'USD', amount: 3000, totalUah: 119400 },
      { type: 'SELL', currency: 'USD', amount: 1000, totalUah: 41000, cancelled: true },
    ];
    const { total } = realizedProfit(ops, mid);
    expect(total).toBeCloseTo(900, 6);
  });

  it('крос-операція — різниця вартостей за серединним курсом', () => {
    // віддали 1000 EUR (mid 43 → 43000), отримали 1075 USD (mid 40 → 43000) → 0
    const ops = [
      { type: 'EXCHANGE', currency: 'EUR', amount: 1000, totalUah: 0, payCurrency: 'USD', payAmount: 1075 },
    ];
    const { byCurrency, total } = realizedProfit(ops, mid);
    expect(byCurrency.EUR).toBeCloseTo(43000 - 43000, 6);
    expect(total).toBeCloseTo(0, 6);
  });

  it('кілька валют підсумовуються', () => {
    const ops = [
      { type: 'SELL', currency: 'USD', amount: 2000, totalUah: 80200 }, // @40.10
      { type: 'BUY', currency: 'USD', amount: 2000, totalUah: 79600 },  // @39.80 → 600
      { type: 'SELL', currency: 'EUR', amount: 1000, totalUah: 43200 }, // @43.20
      { type: 'BUY', currency: 'EUR', amount: 1000, totalUah: 42800 },  // @42.80 → 400
    ];
    const { total } = realizedProfit(ops, mid);
    expect(total).toBeCloseTo(1000, 6);
  });
});
