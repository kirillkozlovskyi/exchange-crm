import { BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { ProfitService } from '../profit/profit.service';

// Будує сервіс із реальним ProfitService на тому ж mock-prisma, доповнюючи його
// потрібними для WAC методами (собівартість каси, $transaction).
function build(prisma: any) {
  prisma.deskCostBasis = prisma.deskCostBasis ?? { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() };
  prisma.deskSoldPool = prisma.deskSoldPool ?? { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn() };
  prisma.$transaction = prisma.$transaction ?? ((arr: any[]) => Promise.all(arr));
  prisma.rate = prisma.rate ?? { findMany: jest.fn().mockResolvedValue([]) };
  return new ShiftsService(prisma, new ProfitService(prisma));
}

describe('ShiftsService — закриття та коригування', () => {
  describe('closeShift()', () => {
    it('прибуток = реалізований спред «з відкупу» (відкуплено × спред)', async () => {
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
      const service = build(prisma);

      const res: any = await service.closeShift(1, { UAH: 7560, USD: 560 });

      // Реаліз. прибуток: куплено 100 @41, продано 40 @41.5.
      // відкуплено = min(100,40)=40; 40×(41.5−41)=20. Відкриті 60 USD не оцінюються.
      expect(Number(res.profit)).toBeCloseTo(20);
      expect(Number(res.factualProfit)).toBeCloseTo(20); // endBalance = calcBalance → без нестачі
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
      const service = build(prisma);
      // calc: USD 100, UAH 5900. Касир нарахував лише 90 USD (нестача 10).
      const res: any = await service.closeShift(1, { UAH: 5900, USD: 90 });
      // Лише купівля (без продажу) → відкупу немає → торговий прибуток 0.
      // Нестача оцінюється за курсом ПРОДАЖУ (рішення власника): 10 USD × 41.5.
      expect(Number(res.profit)).toBeCloseTo(0);
      expect(Number(res.factualProfit)).toBeCloseTo(-415);
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
        // Мок чутливий до статусу: перевірка непідтверджених (PENDING) має бачити порожньо.
        transfer: { findMany: jest.fn(({ where }: any) =>
          Promise.resolve(where?.status === 'PENDING' ? [] : [
            { currency: 'USD', amount: 200, fromDeskId: 9, toDeskId: 7 },
          ])) },
      };
      const service = build(prisma);
      // Касир нарахував 300 USD (100 від операції + 200 передача), UAH 5900.
      const res: any = await service.closeShift(1, { UAH: 5900, USD: 300 });
      // Лише купівля → відкупу немає → торговий прибуток 0.
      expect(Number(res.profit)).toBeCloseTo(0);
      // Фактичний: вилучаємо 200 USD передачі → залишок збігається з очікуваним → 0.
      expect(Number(res.factualProfit)).toBeCloseTo(0);
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
      const service = build(prisma);
      // Очікуваний фізичний залишок: USD 60 (100 − 40), UAH 7900 (5900 + 2000 підкріплення).
      const res: any = await service.closeShift(1, { UAH: 7900, USD: 60 });
      // Розрахунковий залишок враховує рух готівки.
      expect(res.calcBalance).toEqual({ UAH: 7900, USD: 60 });
      // Лише купівля → відкупу немає → торговий прибуток 0 (рух готівки не впливає).
      expect(Number(res.profit)).toBeCloseTo(0);
      // Фактичний: повертаємо інкасовані 40 USD і прибираємо 2000 UAH підкріплення →
      // залишок збігається з очікуваним → 0 (без нестачі).
      expect(Number(res.factualProfit)).toBeCloseTo(0);
      expect(res.netCashMovements).toEqual({ USD: -40, UAH: 2000 });
    });

    it('НЕ дає закрити зміну з непідтвердженою передачею (інакше — фантомна нестача)', async () => {
      // Гроші фізично пішли з каси при створенні передачі, але ledger рахує лише
      // CONFIRMED — закриття показало б хибну нестачу у відправника.
      const shift = {
        id: 1, status: 'OPEN', cashDeskId: 7, openedAt: new Date(),
        cashDesk: { exchangePointId: 1 }, startBalance: { USD: 1000 }, operations: [],
      };
      const prisma = {
        shift: { findUnique: jest.fn().mockResolvedValue(shift), update: jest.fn() },
        rate: { findMany: jest.fn().mockResolvedValue([]) },
        transfer: {
          findMany: jest.fn(({ where }: any) =>
            Promise.resolve(where?.status === 'PENDING'
              ? [{ number: 'TR-20260714-0001', currency: 'USD', amount: 500 }]
              : []),
          ),
        },
      };
      const service = build(prisma);
      await expect(service.closeShift(1, { USD: 500 })).rejects.toThrow(/непідтверджені передачі/);
      expect(prisma.shift.update).not.toHaveBeenCalled();
    });

    it('кидає BadRequestException, якщо зміна вже закрита', async () => {
      const prisma = {
        shift: {
          findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'CLOSED', startBalance: {}, operations: [] }),
          update: jest.fn(),
        },
        rate: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = build(prisma);
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
        cashDeskId: 7,
        openedAt: new Date(),
        cashDesk: { exchangePointId: 1 },
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
        transfer: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = build(prisma);

      const res: any = await service.adjustBalance(1, { USD: 600, UAH: 5900 });

      // USD: 600 − (+100) = 500 ; UAH: 5900 − (−4100) = 10000
      expect(res.startBalance).toEqual({ UAH: 10000, USD: 500 });
    });

    it('враховує USDT-готівку і передачі (раніше коригування їх ігнорувало)', async () => {
      const shift = {
        id: 1,
        status: 'OPEN',
        cashDeskId: 7,
        openedAt: new Date(),
        cashDesk: { exchangePointId: 1 },
        startBalance: { UAH: 1000 },
        operations: [],
        cashMovements: [],
        // Продаж USDT приніс у касу 5000 UAH фізичної готівки.
        usdtOperations: [{ side: 'SELL', settleCurrency: 'UAH', settleAmount: 5000 }],
      };
      const prisma = {
        shift: {
          findUnique: jest.fn().mockResolvedValue(shift),
          update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
        },
        // Отримана передача +200 USD.
        transfer: {
          findMany: jest.fn(({ where }: any) =>
            Promise.resolve(where?.status === 'PENDING' ? [] : [
              { currency: 'USD', amount: 200, fromDeskId: 9, toDeskId: 7, counterCurrency: null, counterAmount: null },
            ])),
        },
      };
      const service = build(prisma);

      // Касир каже: по факту UAH 6100, USD 250.
      const res: any = await service.adjustBalance(1, { UAH: 6100, USD: 250 });

      // UAH: 6100 − 5000 (USDT) = 1100 ; USD: 250 − 200 (передача) = 50
      expect(res.startBalance).toEqual({ UAH: 1100, USD: 50 });
    });
  });

  describe('updateCostBasis()', () => {
    // Собівартість каси зі станом: setBasis(upsert) пише, getBasis(findMany) читає —
    // щоб перевірити РЕАЛЬНИЙ перерахунок прибутку, а не лише виклик моків.
    function statefulBasis(init: Record<string, number> = {}) {
      const m = new Map<string, number>(Object.entries(init));
      return {
        _map: m,
        findMany: jest.fn(async () => [...m].map(([currency, avgCost]) => ({ currency, avgCost }))),
        upsert: jest.fn(async ({ create }: any) => { m.set(create.currency, Number(create.avgCost)); return {}; }),
      };
    }

    it('змінює сер. курс і перераховує прибуток продажу (собівартість — вхід прибутку)', async () => {
      const shift = {
        id: 1, status: 'OPEN', cashDeskId: 7, openedAt: new Date(), openedById: 5,
        cashDesk: { exchangePointId: 1 },
        startBalance: { USD: 100 },
        // Продаж 100 USD по 42.00.
        operations: [{ id: 10, type: 'SELL', currency: 'USD', amount: 100, totalUah: 4200, cancelled: false }],
        cashMovements: [],
      };
      const basis = statefulBasis({ USD: 41 }); // собівартість була 41 → прибуток 100
      const updated: Record<number, number> = {};
      const prisma: any = {
        shift: { findUnique: jest.fn().mockResolvedValue(shift) },
        deskCostBasis: basis,
        rate: { findMany: jest.fn().mockResolvedValue([{ currency: 'USD', buy: 41, sell: 42 }]) },
        operation: { update: jest.fn(async ({ where, data }: any) => { updated[where.id] = data.profit; return {}; }) },
        transfer: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const service = build(prisma);

      // Знижуємо собівартість до 40 → прибуток продажу 100×(42−40)=200.
      const res: any = await service.updateCostBasis(1, { USD: 40 }, { sub: 5, role: 'CASHIER' });

      expect(basis._map.get('USD')).toBe(40);          // сер. курс перезаписано
      expect(updated[10]).toBeCloseTo(200, 6);          // прибуток операції перераховано
      expect(res.costBasis).toEqual({ USD: 40 });
    });

    it('не дає редагувати закриту зміну (собівартість уже перенесена далі)', async () => {
      const prisma: any = {
        shift: { findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'CLOSED', cashDeskId: 7, openedById: 5 }) },
      };
      const service = build(prisma);
      await expect(service.updateCostBasis(1, { USD: 40 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('касир не може редагувати чужу зміну', async () => {
      const prisma: any = {
        shift: { findUnique: jest.fn().mockResolvedValue({ id: 1, status: 'OPEN', cashDeskId: 7, openedById: 5 }) },
      };
      const service = build(prisma);
      await expect(
        service.updateCostBasis(1, { USD: 40 }, { sub: 99, role: 'CASHIER' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('closeShift() — власність зміни', () => {
    function makePrisma(shift: any) {
      return {
        shift: {
          findUnique: jest.fn().mockResolvedValue(shift),
          update: jest.fn(({ data }: any) => Promise.resolve({ id: 1, ...data })),
        },
        rate: { findMany: jest.fn().mockResolvedValue([]) },
        transfer: { findMany: jest.fn().mockResolvedValue([]) },
      };
    }
    const baseShift = {
      id: 1, status: 'OPEN', cashDeskId: 7, openedAt: new Date(), openedById: 5,
      startBalance: {}, operations: [], cashDesk: { exchangePointId: 1 },
    };

    it('касир НЕ може закрити чужу зміну', async () => {
      const service = build(makePrisma(baseShift));
      await expect(
        service.closeShift(1, {}, { sub: 99, role: 'CASHIER' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('касир закриває СВОЮ зміну; адмін — будь-чию', async () => {
      const own = build(makePrisma(baseShift));
      await expect(own.closeShift(1, {}, { sub: 5, role: 'CASHIER' })).resolves.toBeDefined();

      const admin = build(makePrisma(baseShift));
      await expect(admin.closeShift(1, {}, { sub: 99, role: 'ADMIN' })).resolves.toBeDefined();
    });
  });
});
