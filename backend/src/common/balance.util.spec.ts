import { operationsDelta, applyOperationsToBalance, BalanceOperation } from './balance.util';

describe('balance.util', () => {
  describe('operationsDelta', () => {
    it('BUY: каса +валюта, -UAH', () => {
      const ops: BalanceOperation[] = [
        { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100 },
      ];
      expect(operationsDelta(ops)).toEqual({ USD: 100, UAH: -4100 });
    });

    it('SELL: каса -валюта, +UAH', () => {
      const ops: BalanceOperation[] = [
        { type: 'SELL', currency: 'USD', amount: 100, totalUah: 4150 },
      ];
      expect(operationsDelta(ops)).toEqual({ USD: -100, UAH: 4150 });
    });

    it('EXCHANGE поводиться як SELL по полю currency (−amount, +UAH)', () => {
      const ops: BalanceOperation[] = [
        { type: 'EXCHANGE', currency: 'EUR', amount: 90, totalUah: 4100 },
      ];
      expect(operationsDelta(ops)).toEqual({ EUR: -90, UAH: 4100 });
    });

    it('накопичує по валютах і UAH через кілька операцій', () => {
      const ops: BalanceOperation[] = [
        { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100 },
        { type: 'SELL', currency: 'USD', amount: 40, totalUah: 1660 },
        { type: 'BUY', currency: 'EUR', amount: 50, totalUah: 2200 },
      ];
      expect(operationsDelta(ops)).toEqual({
        USD: 60, // +100 -40
        EUR: 50,
        UAH: -4100 + 1660 - 2200, // -4640
      });
    });

    it('крос: +payCurrency (отримали), -currency (віддали), без UAH', () => {
      // клієнт дав 1000 USD, отримав 850 EUR
      const ops: BalanceOperation[] = [
        { type: 'SELL', currency: 'EUR', amount: 850, totalUah: 44460, payCurrency: 'USD', payAmount: 1000 },
      ];
      expect(operationsDelta(ops)).toEqual({ USD: 1000, EUR: -850 });
    });

    it('старий формат BUY (currency=UAH, валюта в payCurrency): +валюта, -UAH', () => {
      const ops: BalanceOperation[] = [
        { type: 'BUY', currency: 'UAH', amount: 1000, totalUah: 44460, payCurrency: 'USD', payAmount: 1000 },
      ];
      expect(operationsDelta(ops)).toEqual({ USD: 1000, UAH: -44460 });
    });

    it('ігнорує скасовані (cancelled) операції', () => {
      const ops: BalanceOperation[] = [
        { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100 },
        { type: 'BUY', currency: 'USD', amount: 999, totalUah: 99999, cancelled: true },
      ];
      expect(operationsDelta(ops)).toEqual({ USD: 100, UAH: -4100 });
    });

    it('приймає Decimal-подібні значення (рядки)', () => {
      const ops: BalanceOperation[] = [
        { type: 'BUY', currency: 'USD', amount: '100.50', totalUah: '4120.50' },
      ];
      expect(operationsDelta(ops)).toEqual({ USD: 100.5, UAH: -4120.5 });
    });

    it('порожній список → порожня дельта', () => {
      expect(operationsDelta([])).toEqual({});
    });
  });

  describe('applyOperationsToBalance', () => {
    it('початковий баланс + дельта операцій', () => {
      const start = { UAH: 10000, USD: 500 };
      const ops: BalanceOperation[] = [
        { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100 },
        { type: 'SELL', currency: 'EUR', amount: 50, totalUah: 2225 },
      ];
      expect(applyOperationsToBalance(start, ops)).toEqual({
        UAH: 10000 - 4100 + 2225, // 8125
        USD: 600,
        EUR: -50, // не було в старті
      });
    });

    it('не мутує переданий startBalance', () => {
      const start = { UAH: 1000 };
      applyOperationsToBalance(start, [
        { type: 'SELL', currency: 'USD', amount: 10, totalUah: 415 },
      ]);
      expect(start).toEqual({ UAH: 1000 });
    });

    it('без операцій повертає копію початкового балансу', () => {
      const start = { UAH: 1000, USD: 50 };
      expect(applyOperationsToBalance(start, [])).toEqual(start);
    });
  });
});
