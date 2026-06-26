import { BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';

describe('ShiftsService — закриття та коригування', () => {
  describe('closeShift()', () => {
    it('прибуток = приріст вартості каси за серединним курсом (без подвійного спреду)', async () => {
      const shift = {
        id: 1,
        status: 'OPEN',
        startBalance: { UAH: 10000, USD: 500 },
        cashDesk: { exchangePointId: 1 },
        operations: [
          { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, cancelled: false },  // куп. @41
          { type: 'SELL', currency: 'USD', amount: 40, totalUah: 1660, cancelled: false },   // прод. @41.5
          { type: 'BUY', currency: 'USD', amount: 999, totalUah: 99999, cancelled: true },   // скасована
        ],
      };
      const prisma = {
        shift: {
          findUnique: jest.fn().mockResolvedValue(shift),
          update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
        },
        rate: {
          findMany: jest.fn().mockResolvedValue([{ currency: 'USD', buy: 41, sell: 41.5 }]), // mid 41.25
        },
      };
      const service = new ShiftsService(prisma as any);

      const res: any = await service.closeShift(1, { UAH: 7560, USD: 560 });

      // calc: USD 560, UAH 7560. mid(USD)=41.25.
      // profit = (7560 + 560×41.25) − (10000 + 500×41.25) = 30660 − 30625 = 35
      // (реаліз. спред 40×0.5=20 + переоцінка відкритих 60 USD × 0.25 = 15)
      expect(Number(res.profit)).toBeCloseTo(35);
      expect(Number(res.factualProfit)).toBeCloseTo(35); // endBalance = calcBalance → без нестачі
      expect(res.calcBalance).toEqual({ UAH: 7560, USD: 560 });
    });

    it('фактичний прибуток менший за торговий при нестачі касира', async () => {
      const shift = {
        id: 1, status: 'OPEN', startBalance: { UAH: 10000 }, cashDesk: { exchangePointId: 1 },
        operations: [{ type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, cancelled: false }],
      };
      const prisma = {
        shift: { findUnique: jest.fn().mockResolvedValue(shift), update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })) },
        rate: { findMany: jest.fn().mockResolvedValue([{ currency: 'USD', buy: 41, sell: 41.5 }]) },
      };
      const service = new ShiftsService(prisma as any);
      // calc: USD 100, UAH 5900. Касир нарахував лише 90 USD (нестача 10).
      const res: any = await service.closeShift(1, { UAH: 5900, USD: 90 });
      // торговий: (5900 + 100×41.25) − 10000 = 25 ; фактичний: (5900 + 90×41.25) − 10000 = -387.5
      expect(Number(res.profit)).toBeCloseTo(25);
      expect(Number(res.factualProfit)).toBeCloseTo(-387.5);
    });

    it('кидає BadRequestException, якщо зміна вже закрита', async () => {
      const prisma = {
        shift: {
          findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'CLOSED', startBalance: {}, operations: [] }),
          update: jest.fn(),
        },
        rate: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new ShiftsService(prisma as any);
      await expect(service.closeShift(1, {})).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('adjustBalance()', () => {
    it('перераховує startBalance так, щоб поточний збігся з введеним', async () => {
      // Поточний = start + opsDelta. Якщо касир каже "по факту 600 USD",
      // а операції дали +100 USD, то новий start = 600 − 100 = 500.
      const shift = {
        id: 1,
        status: 'OPEN',
        startBalance: { UAH: 10000, USD: 500 },
        operations: [
          { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, cancelled: false },
        ],
      };
      const prisma = {
        shift: {
          findUnique: jest.fn().mockResolvedValue(shift),
          update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
        },
      };
      const service = new ShiftsService(prisma as any);

      const res: any = await service.adjustBalance(1, { USD: 600, UAH: 5900 });

      // USD: 600 − (+100) = 500 ; UAH: 5900 − (−4100) = 10000
      expect(res.startBalance).toEqual({ UAH: 10000, USD: 500 });
    });
  });
});
