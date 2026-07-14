import { shiftCashBalance, confirmedTransfersNetForDesk } from './shift-ledger.util';

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

describe('confirmedTransfersNetForDesk — часові межі зміни', () => {
  // Передачі каси беруться з моменту відкриття зміни. Для ЗАКРИТОЇ зміни
  // обовʼязкова верхня межа (closedAt): інакше передача, підтверджена вже на
  // НАСТУПНІЙ зміні тієї ж каси, потрапила б у звіт закритої (її confirmedAt
  // теж >= openedAt закритої) і зіпсувала б її баланс та розбіжність.
  const openedAt = new Date('2026-07-14T06:00:00Z');
  const closedAt = new Date('2026-07-14T15:00:00Z');

  function prismaSpy() {
    const calls: any[] = [];
    return {
      calls,
      transfer: {
        findMany: jest.fn((args: any) => {
          calls.push(args);
          return Promise.resolve([]);
        }),
      },
    };
  }

  it('закрита зміна: запит обмежено closedAt', async () => {
    const prisma = prismaSpy();
    await confirmedTransfersNetForDesk(prisma as any, 7, openedAt, closedAt);
    expect(prisma.calls[0].where.confirmedAt).toEqual({ gte: openedAt, lte: closedAt });
  });

  it('відкрита зміна: верхньої межі немає (передачі рахуються далі)', async () => {
    const prisma = prismaSpy();
    await confirmedTransfersNetForDesk(prisma as any, 7, openedAt);
    expect(prisma.calls[0].where.confirmedAt).toEqual({ gte: openedAt });
  });
});
