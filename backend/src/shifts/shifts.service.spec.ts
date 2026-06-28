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
        transfer: { findMany: jest.fn().mockResolvedValue([]) },
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
        transfer: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new ShiftsService(prisma as any);
      // calc: USD 100, UAH 5900. Касир нарахував лише 90 USD (нестача 10).
      const res: any = await service.closeShift(1, { UAH: 5900, USD: 90 });
      // торговий: (5900 + 100×41.25) − 10000 = 25 ; фактичний: (5900 + 90×41.25) − 10000 = -387.5
      expect(Number(res.profit)).toBeCloseTo(25);
      expect(Number(res.factualProfit)).toBeCloseTo(-387.5);
    });

    it('передачі між касами не входять у фактичний прибуток', async () => {
      const shift = {
        id: 1, status: 'OPEN', cashDeskId: 7, startBalance: { UAH: 10000 },
        cashDesk: { exchangePointId: 1 },
        operations: [{ type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, cancelled: false }],
      };
      const prisma = {
        shift: { findUnique: jest.fn().mockResolvedValue(shift), update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })) },
        rate: { findMany: jest.fn().mockResolvedValue([{ currency: 'USD', buy: 41, sell: 41.5 }]) }, // mid 41.25
        // На касу 7 надійшла передача 200 USD → фізично в касі 300 USD, але це не прибуток.
        transfer: { findMany: jest.fn().mockResolvedValue([
          { currency: 'USD', amount: 200, fromDeskId: 9, toDeskId: 7 },
        ]) },
      };
      const service = new ShiftsService(prisma as any);
      // Касир нарахував 300 USD (100 від операції + 200 передача), UAH 5900.
      const res: any = await service.closeShift(1, { UAH: 5900, USD: 300 });
      // Торговий (передачі немає в calcBalance): (5900 + 100×41.25) − 10000 = 25
      expect(Number(res.profit)).toBeCloseTo(25);
      // Фактичний: вилучаємо 200 USD передачі → (5900 + (300−200)×41.25) − 10000 = 25 (без нестачі)
      expect(Number(res.factualProfit)).toBeCloseTo(25);
      expect(res.netTransfers).toEqual({ USD: 200 });
    });

    it('рух готівки (інкасація −, підкріплення +) змінює залишок, але не прибуток', async () => {
      const shift = {
        id: 1, status: 'OPEN', cashDeskId: 7, startBalance: { UAH: 10000 },
        cashDesk: { exchangePointId: 1 },
        operations: [{ type: 'BUY', currency: 'USD', amount: 100, totalUah: 4100, cancelled: false }],
        // Інкасували 40 USD (OUT) і підкріпили касу на 2000 UAH (IN).
        cashMovements: [
          { direction: 'OUT', currency: 'USD', amount: 40 },
          { direction: 'IN', currency: 'UAH', amount: 2000 },
        ],
      };
      const prisma = {
        shift: { findUnique: jest.fn().mockResolvedValue(shift), update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })) },
        rate: { findMany: jest.fn().mockResolvedValue([{ currency: 'USD', buy: 41, sell: 41.5 }]) }, // mid 41.25
        transfer: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = new ShiftsService(prisma as any);
      // Очікуваний фізичний залишок: USD 60 (100 − 40), UAH 7900 (5900 + 2000 підкріплення).
      const res: any = await service.closeShift(1, { UAH: 7900, USD: 60 });
      // Розрахунковий залишок враховує рух готівки.
      expect(res.calcBalance).toEqual({ UAH: 7900, USD: 60 });
      // Торговий прибуток рахується ДО руху готівки: (5900 + 100×41.25) − 10000 = 25
      expect(Number(res.profit)).toBeCloseTo(25);
      // Фактичний: повертаємо інкасовані 40 USD і прибираємо 2000 UAH підкріплення →
      // (5900 + (60+40)×41.25) − 10000 = 25 (без нестачі)
      expect(Number(res.factualProfit)).toBeCloseTo(25);
      expect(res.netCashMovements).toEqual({ USD: -40, UAH: 2000 });
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
