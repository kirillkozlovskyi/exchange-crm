import { usdtCashDelta, usdtProfit } from './usdt.util';

describe('usdt.util', () => {
  it('SELL додає фізичну готівку, BUY — віднімає', () => {
    const ops = [
      { side: 'SELL', settleCurrency: 'USD', settleAmount: 10100, profitUah: 4125 },
      { side: 'BUY', settleCurrency: 'UAH', settleAmount: 400000, profitUah: 2000 },
      { side: 'SELL', settleCurrency: 'USD', settleAmount: 5050, profitUah: 2062.5 },
    ];
    expect(usdtCashDelta(ops)).toEqual({ USD: 15150, UAH: -400000 });
  });

  it('підсумовує маржу у гривні', () => {
    const ops = [
      { side: 'SELL', settleCurrency: 'USD', settleAmount: 10100, profitUah: 4125 },
      { side: 'BUY', settleCurrency: 'UAH', settleAmount: 400000, profitUah: 2000 },
    ];
    expect(usdtProfit(ops)).toBeCloseTo(6125, 6);
  });

  it('порожній список — нулі', () => {
    expect(usdtCashDelta([])).toEqual({});
    expect(usdtProfit([])).toBe(0);
  });
});
