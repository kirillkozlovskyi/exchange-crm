import { computeOperationTotals, RateLookup } from './operations.math';

// Курси точки. EUR/USD підібрані під бізнес-приклад зі скриншоту.
const RATES: Record<string, { buy: number; sell: number }> = {
  USD: { buy: 45.0, sell: 45.15 },
  EUR: { buy: 51.55, sell: 52.0 },
};
const lookup: RateLookup = (cur) => RATES[cur] ?? null;
const noRates: RateLookup = () => null;

describe('computeOperationTotals', () => {
  it('SELL: клієнт дає UAH → отримує валюту', () => {
    const r = computeOperationTotals(
      { currency: 'USD', amount: 100, rate: 45.15 },
      lookup,
    );
    expect(r.type).toBe('SELL');
    expect(r.totalUah).toBeCloseTo(4515); // 100 × 45.15
    expect(r.profit).toBeCloseTo(15); // 100 × (45.15 − 45.00)
  });

  it('BUY (старий формат): currency=UAH, валюта в payCurrency', () => {
    const r = computeOperationTotals(
      { currency: 'UAH', amount: 100, rate: 45.0, payCurrency: 'USD', payAmount: 100, mode: 'BUY' },
      lookup,
    );
    expect(r.type).toBe('BUY');
    expect(r.totalUah).toBeCloseTo(4500); // 100 × 45.00
    expect(r.profit).toBeCloseTo(15); // 100 × (45.15 − 45.00)
  });

  it('BUY (новий формат): currency=валюта, тип за mode=BUY', () => {
    const r = computeOperationTotals(
      { currency: 'USD', amount: 100, rate: 45.0, mode: 'BUY' }, // payCurrency не задано (не крос)
      lookup,
    );
    expect(r.type).toBe('BUY'); // не SELL, попри форму «currency=валюта»
    expect(r.totalUah).toBeCloseTo(4500); // 100 × 45.00 (курс купівлі)
    expect(r.profit).toBeCloseTo(15); // 100 × (45.15 − 45.00)
  });

  it('SELL: та сама форма (currency=валюта), але mode=SELL → SELL', () => {
    const r = computeOperationTotals(
      { currency: 'USD', amount: 100, rate: 45.15, mode: 'SELL' },
      lookup,
    );
    expect(r.type).toBe('SELL');
  });

  describe('крос EUR → USD «через гривню» (бізнес-приклад)', () => {
    // Клієнт дає 1000 EUR, хоче USD.
    // Курс = buy(EUR)/sell(USD) = 51.55/45.15 = 1.1417
    // totalUah = 1000 × 51.55 = 51 550 ; USD = 51 550 / 45.15 = 1141.74
    const payAmount = 1000;
    const totalUahExpected = 51550;
    const usdAmount = +(totalUahExpected / RATES.USD.sell).toFixed(2); // 1141.75

    it('totalUah = payAmount × buy(EUR)', () => {
      const r = computeOperationTotals(
        { currency: 'USD', amount: usdAmount, rate: 1.1417, payCurrency: 'EUR', payAmount, mode: 'BUY' },
        lookup,
      );
      expect(r.totalUah).toBeCloseTo(totalUahExpected, 0); // 51 550 ₴
    });

    it('profit = спред на обох плечах (купівля EUR + продаж USD)', () => {
      const r = computeOperationTotals(
        { currency: 'USD', amount: usdAmount, rate: 1.1417, payCurrency: 'EUR', payAmount, mode: 'BUY' },
        lookup,
      );
      // payAmount×sell(EUR) − amount×buy(USD) = 1000×52 − 1141.75×45
      const expected = payAmount * RATES.EUR.sell - usdAmount * RATES.USD.buy;
      expect(r.profit).toBeCloseTo(expected);
      // декомпозиція: 1000×(52−51.55) + 1141.75×(45.15−45) = 450 + 171.26
      // (тотожна формулі коду з точністю до округлення USD-суми до копійок)
      expect(r.profit).toBeCloseTo(
        payAmount * (RATES.EUR.sell - RATES.EUR.buy) + usdAmount * (RATES.USD.sell - RATES.USD.buy),
        1,
      );
    });

    it('зберігає тип за mode касира (BUY/SELL), без mode → EXCHANGE', () => {
      expect(computeOperationTotals(
        { currency: 'USD', amount: usdAmount, rate: 1.1417, payCurrency: 'EUR', payAmount, mode: 'SELL' },
        lookup,
      ).type).toBe('SELL');

      expect(computeOperationTotals(
        { currency: 'USD', amount: usdAmount, rate: 1.1417, payCurrency: 'EUR', payAmount },
        lookup,
      ).type).toBe('EXCHANGE');
    });
  });

  it('без активного курсу: SELL рахує totalUah з rate, profit = 0', () => {
    const r = computeOperationTotals({ currency: 'USD', amount: 100, rate: 45.15 }, noRates);
    expect(r.totalUah).toBeCloseTo(4515);
    expect(r.profit).toBe(0);
  });
});
