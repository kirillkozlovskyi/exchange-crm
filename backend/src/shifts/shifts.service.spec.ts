import { BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';

describe('ShiftsService — закриття та коригування', () => {
  describe('closeShift()', () => {
    it('сумує profit лише активних операцій і рахує розрахунковий залишок', async () => {
      const shift = {
        id: 1,
        status: 'OPEN',
        startBalance: { UAH: 10000, USD: 500 },
        operations: [
          { type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, profit: 50, cancelled: false },
          { type: 'SELL', currency: 'USD', amount: 40, totalUah: 1660, profit: 20, cancelled: false },
          // скасована — не враховується ні в profit, ні в балансі
          { type: 'BUY', currency: 'USD', amount: 999, totalUah: 99999, profit: 999, cancelled: true },
        ],
      };
      const prisma = {
        shift: {
          findUnique: jest.fn().mockResolvedValue(shift),
          update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
        },
      };
      const service = new ShiftsService(prisma as any);

      const res: any = await service.closeShift(1, { UAH: 7500, USD: 560 });

      expect(Number(res.profit)).toBeCloseTo(70); // 50 + 20
      expect(res.status).toBe('CLOSED');
      // USD: 500 +100 -40 = 560 ; UAH: 10000 -4100 +1660 = 7560
      expect(res.calcBalance).toEqual({ UAH: 7560, USD: 560 });
      expect(res.endBalance).toEqual({ UAH: 7500, USD: 560 });
    });

    it('кидає BadRequestException, якщо зміна вже закрита', async () => {
      const prisma = {
        shift: {
          findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'CLOSED', startBalance: {}, operations: [] }),
          update: jest.fn(),
        },
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
