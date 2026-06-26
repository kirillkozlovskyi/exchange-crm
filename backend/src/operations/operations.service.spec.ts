import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OperationsService } from './operations.service';

/**
 * Тести грошової математики OperationsService.create / .update.
 *
 * Курси для точки (ACTIVE):
 *   USD: buy 41.00 / sell 41.50  (спред 0.50)
 *   EUR: buy 44.00 / sell 44.50  (спред 0.50)
 */
const RATES: Record<string, { buy: number; sell: number }> = {
  USD: { buy: 41, sell: 41.5 },
  EUR: { buy: 44, sell: 44.5 },
};

function makePrisma(opts: { ratesPresent?: boolean } = {}) {
  const ratesPresent = opts.ratesPresent ?? true;
  return {
    shift: {
      findUnique: jest.fn().mockResolvedValue({
        id: 1,
        status: 'OPEN',
        cashDesk: { exchangePointId: 1, exchangePoint: { code: 'T1' } },
      }),
    },
    rate: {
      findFirst: jest.fn(({ where }: any) => {
        if (!ratesPresent) return Promise.resolve(null);
        const r = RATES[where.currency];
        return Promise.resolve(r ? { currency: where.currency, ...r, status: 'ACTIVE' } : null);
      }),
    },
    operation: {
      count: jest.fn().mockResolvedValue(0),
      // повертаємо data назад, щоб перевіряти обчислені totalUah/profit/type
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
    },
    operationEdit: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
  };
}

const settingsStub = { getStornoWindowMinutes: jest.fn().mockResolvedValue(5) };

describe('OperationsService — грошова математика', () => {
  describe('create()', () => {
    it('SELL (клієнт дає UAH, отримує валюту): totalUah = amount × rate, profit = amount × спред', async () => {
      const prisma = makePrisma();
      const service = new OperationsService(prisma as any, settingsStub as any);

      const res: any = await service.create(
        { shiftId: 1, currency: 'USD', amount: 100, rate: 41.5, mode: 'SELL' },
        7,
      );

      expect(res.type).toBe('SELL');
      expect(Number(res.totalUah)).toBeCloseTo(4150); // 100 × 41.5
      expect(Number(res.profit)).toBeCloseTo(50); // 100 × (41.5 − 41)
      expect(res.payCurrency).toBeNull();
      expect(res.payAmount).toBeNull();
      expect(res.cashierId).toBe(7);
      expect(res.number).toBe('T1-' + dateStr() + '-000001');
    });

    it('BUY (клієнт дає валюту, отримує UAH): totalUah = amount × rate, profit = amount × спред', async () => {
      const prisma = makePrisma();
      const service = new OperationsService(prisma as any, settingsStub as any);

      const res: any = await service.create(
        { shiftId: 1, currency: 'UAH', amount: 100, rate: 41, payCurrency: 'USD', payAmount: 100, mode: 'BUY' },
        7,
      );

      expect(res.type).toBe('BUY');
      expect(Number(res.totalUah)).toBeCloseTo(4100); // 100 × 41
      expect(Number(res.profit)).toBeCloseTo(50); // 100 × (41.5 − 41)
      expect(res.payCurrency).toBe('USD');
      expect(Number(res.payAmount)).toBe(100);
    });

    it('крос (валюта→валюта) у режимі BUY: type=BUY, totalUah у UAH, profit за крос-формулою', async () => {
      const prisma = makePrisma();
      const service = new OperationsService(prisma as any, settingsStub as any);

      // Клієнт дає 100 USD, отримує 90 EUR
      const res: any = await service.create(
        { shiftId: 1, currency: 'EUR', amount: 90, rate: 0.92, payCurrency: 'USD', payAmount: 100, mode: 'BUY' },
        7,
      );

      expect(res.type).toBe('BUY'); // успадковує mode касира
      // totalUah = payAmount × buy(USD) = 100 × 41 = 4100
      expect(Number(res.totalUah)).toBeCloseTo(4100);
      // profit = payAmount × sell(USD) − amount × buy(EUR) = 100×41.5 − 90×44 = 4150 − 3960
      expect(Number(res.profit)).toBeCloseTo(190);
      expect(res.payCurrency).toBe('USD');
      expect(Number(res.payAmount)).toBe(100);
    });

    it('крос без вказаного mode → type=EXCHANGE (fallback)', async () => {
      const prisma = makePrisma();
      const service = new OperationsService(prisma as any, settingsStub as any);

      const res: any = await service.create(
        { shiftId: 1, currency: 'EUR', amount: 90, rate: 0.92, payCurrency: 'USD', payAmount: 100 },
        7,
      );

      expect(res.type).toBe('EXCHANGE');
    });

    it('SELL без активного курсу: totalUah рахується з dto.rate, profit = 0', async () => {
      const prisma = makePrisma({ ratesPresent: false });
      const service = new OperationsService(prisma as any, settingsStub as any);

      const res: any = await service.create(
        { shiftId: 1, currency: 'USD', amount: 100, rate: 41.5, mode: 'SELL' },
        7,
      );

      expect(Number(res.totalUah)).toBeCloseTo(4150); // все одно amount × rate
      expect(Number(res.profit)).toBe(0); // немає курсу → спред невідомий
    });

    it('кидає NotFoundException, якщо зміни немає', async () => {
      const prisma = makePrisma();
      prisma.shift.findUnique.mockResolvedValue(null);
      const service = new OperationsService(prisma as any, settingsStub as any);

      await expect(
        service.create({ shiftId: 999, currency: 'USD', amount: 1, rate: 41 }, 7),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('кидає BadRequestException, якщо зміна закрита', async () => {
      const prisma = makePrisma();
      prisma.shift.findUnique.mockResolvedValue({
        id: 1, status: 'CLOSED',
        cashDesk: { exchangePointId: 1, exchangePoint: { code: 'T1' } },
      });
      const service = new OperationsService(prisma as any, settingsStub as any);

      await expect(
        service.create({ shiftId: 1, currency: 'USD', amount: 1, rate: 41 }, 7),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update()', () => {
    function prismaForUpdate(op: any) {
      const prisma = makePrisma();
      prisma.operation.findUnique.mockResolvedValue({
        ...op,
        shift: { status: 'OPEN', cashDesk: { exchangePointId: 1, exchangePoint: { code: 'T1' } } },
      });
      return prisma;
    }

    it('SELL: перераховує totalUah та profit, пише OperationEdit', async () => {
      const prisma = prismaForUpdate({
        id: 5, type: 'SELL', currency: 'USD', amount: 100, rate: 41.5, payCurrency: null, payAmount: null,
      });
      const service = new OperationsService(prisma as any, settingsStub as any);

      const res: any = await service.update(5, { amount: 200, rate: 42, note: 'fix' }, 9);

      expect(Number(res.totalUah)).toBeCloseTo(8400); // 200 × 42
      expect(Number(res.profit)).toBeCloseTo(100); // 200 × (41.5 − 41)
      expect(prisma.operationEdit.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationId: 5, editedById: 9, prevAmount: 100, prevRate: 41.5, newAmount: 200, newRate: 42,
          }),
        }),
      );
    });

    it('BUY: profit = новий amount × спред payCurrency', async () => {
      const prisma = prismaForUpdate({
        id: 6, type: 'BUY', currency: 'UAH', amount: 100, rate: 41, payCurrency: 'USD', payAmount: 100,
      });
      const service = new OperationsService(prisma as any, settingsStub as any);

      const res: any = await service.update(6, { amount: 150, rate: 41 }, 9);

      expect(Number(res.totalUah)).toBeCloseTo(6150); // 150 × 41
      expect(Number(res.profit)).toBeCloseTo(75); // 150 × (41.5 − 41)
    });

    it('EXCHANGE: payAmount незмінний, перерахунок на нових курсах', async () => {
      const prisma = prismaForUpdate({
        id: 7, type: 'EXCHANGE', currency: 'EUR', amount: 90, rate: 0.92, payCurrency: 'USD', payAmount: 100,
      });
      const service = new OperationsService(prisma as any, settingsStub as any);

      const res: any = await service.update(7, { amount: 80, rate: 0.9 }, 9);

      // totalUah = payAmount × buy(USD) = 100 × 41 = 4100
      expect(Number(res.totalUah)).toBeCloseTo(4100);
      // profit = payAmount × sell(USD) − amount × buy(EUR) = 100×41.5 − 80×44 = 4150 − 3520
      expect(Number(res.profit)).toBeCloseTo(630);
    });

    it('крос, збережений як BUY (mode), редагується крос-логікою, а не як звичайний BUY', async () => {
      // currency=EUR (отримує), payCurrency=USD (дав), type=BUY (mode касира).
      // Раніше update() гілкувався за type='BUY' і рахував totalUah=amount×rate (хибно).
      const prisma = prismaForUpdate({
        id: 8, type: 'BUY', currency: 'EUR', amount: 90, rate: 0.92, payCurrency: 'USD', payAmount: 100,
      });
      const service = new OperationsService(prisma as any, settingsStub as any);

      const res: any = await service.update(8, { amount: 88, rate: 0.92 }, 9);

      // Крос: totalUah = payAmount × buy(USD) = 100 × 41 = 4100 (НЕ 88×0.92)
      expect(Number(res.totalUah)).toBeCloseTo(4100);
      // profit = payAmount×sell(USD) − amount×buy(EUR) = 100×41.5 − 88×44 = 4150 − 3872
      expect(Number(res.profit)).toBeCloseTo(278);
    });

    it('кидає BadRequestException при закритій зміні', async () => {
      const prisma = makePrisma();
      prisma.operation.findUnique.mockResolvedValue({
        id: 5, type: 'SELL', currency: 'USD', amount: 100, rate: 41.5,
        shift: { status: 'CLOSED', cashDesk: { exchangePointId: 1, exchangePoint: { code: 'T1' } } },
      });
      const service = new OperationsService(prisma as any, settingsStub as any);

      await expect(service.update(5, { amount: 1, rate: 41 }, 9)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('storno()', () => {
    function setup(op: any, overallLast: any, windowMin = 5) {
      const prisma = makePrisma();
      prisma.operation.findUnique.mockResolvedValue(op);
      prisma.operation.findFirst.mockResolvedValue(overallLast);
      const settings = { getStornoWindowMinutes: jest.fn().mockResolvedValue(windowMin) };
      return { prisma, service: new OperationsService(prisma as any, settings as any) };
    }

    it('скасовує останню операцію в межах часового вікна', async () => {
      const op = { id: 10, shiftId: 1, cancelled: false, createdAt: new Date(), shift: { status: 'OPEN' } };
      const { prisma, service } = setup(op, { id: 10 });

      const res: any = await service.storno(10, 7, 'помилка');

      expect(prisma.operation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { cancelled: true, cancelNote: 'помилка' } }),
      );
      expect(res.cancelled).toBe(true);
    });

    it('забороняє сторно не останньої операції зміни', async () => {
      const op = { id: 10, shiftId: 1, cancelled: false, createdAt: new Date(), shift: { status: 'OPEN' } };
      const { service } = setup(op, { id: 11 }); // остання — інша
      await expect(service.storno(10, 7)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('забороняє сторно вже скасованої операції', async () => {
      const op = { id: 10, shiftId: 1, cancelled: true, createdAt: new Date(), shift: { status: 'OPEN' } };
      const { service } = setup(op, { id: 10 });
      await expect(service.storno(10, 7)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('забороняє сторно після завершення часового вікна', async () => {
      const old = new Date(Date.now() - 10 * 60 * 1000); // 10 хв тому
      const op = { id: 10, shiftId: 1, cancelled: false, createdAt: old, shift: { status: 'OPEN' } };
      const { service } = setup(op, { id: 10 }, 5); // вікно 5 хв
      await expect(service.storno(10, 7)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('забороняє сторно у закритій зміні', async () => {
      const op = { id: 10, shiftId: 1, cancelled: false, createdAt: new Date(), shift: { status: 'CLOSED' } };
      const { service } = setup(op, { id: 10 });
      await expect(service.storno(10, 7)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

function dateStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
