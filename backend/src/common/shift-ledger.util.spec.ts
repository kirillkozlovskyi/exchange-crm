import { shiftCashBalance } from './shift-ledger.util';

/**
 * Ledger-розрахунок поточної готівки зміни — регресія на баг «Недостатньо UAH:
 * в касі −57963»: перевірка інкасації рахувала баланс без USDT-готівки і передач.
 */
describe('shiftCashBalance — єдиний ledger', () => {
  it('операції + рух готівки + USDT-готівка + передачі складаються в один баланс', () => {
    const balance = shiftCashBalance(
      {
        startBalance: { UAH: 1507, USD: 300 },
        operations: [
          // BUY: каса отримала 100 USD, віддала 4100 UAH
          { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, cancelled: false },
          // скасована — ігнорується
          { type: 'SELL', currency: 'USD', amount: 999, totalUah: 99999, cancelled: true },
        ],
        cashMovements: [
          { direction: 'IN', currency: 'UAH', amount: 50000 }, // підкріплення з банку
        ],
        usdtOperations: [
          // SELL USDT: каса прийняла 136000 UAH фізичної готівки
          { side: 'SELL', settleCurrency: 'UAH', settleAmount: 136000 },
        ],
      },
      { USD: 200 }, // отримана передача
    );

    expect(balance.UAH).toBeCloseTo(1507 - 4100 + 50000 + 136000); // 183407
    expect(balance.USD).toBeCloseTo(300 + 100 + 200); // 600
  });

  it('відсутні частини не ламають розрахунок (порожня зміна)', () => {
    expect(shiftCashBalance({ startBalance: { UAH: 100 }, operations: [] })).toEqual({ UAH: 100 });
  });
});
