import { BadRequestException } from '@nestjs/common';
import { TransfersService } from './transfers.service';

/**
 * Серверні правила передач (раніше все трималося лише на фронті):
 *  • відправка — лише зі своєї каси з відкритою зміною, з перевіркою готівки
 *    (PENDING-передачі резервують гроші);
 *  • підтвердження/відхилення — лише каса-отримувач (адмін — будь-яку);
 *  • своп при підтвердженні перевіряє достатність зустрічної валюти.
 */

const CASHIER = { sub: 5, role: 'CASHIER' };
const ADMIN = { sub: 99, role: 'ADMIN' };

// Зміна на касі 1 (відправник, userId=5): 1000 UAH у касі.
const fromShift = {
  id: 1, cashDeskId: 1, openedById: 5, openedAt: new Date(), status: 'OPEN',
  startBalance: { UAH: 1000 },
  operations: [], cashMovements: [], usdtOperations: [],
};
// Зміна на касі 2 (отримувач, userId=7): 50 USD у касі.
const toShift = {
  id: 2, cashDeskId: 2, openedById: 7, openedAt: new Date(), status: 'OPEN',
  startBalance: { USD: 50 },
  operations: [], cashMovements: [], usdtOperations: [],
};

function makePrisma(opts: {
  shifts?: any[];           // відкриті зміни, findFirst шукає по cashDeskId
  pendingSum?: number;      // сума PENDING-передач відправника
  transfer?: any;           // для confirm/reject
} = {}) {
  const shifts = opts.shifts ?? [fromShift, toShift];
  return {
    shift: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(shifts.find((s) => s.cashDeskId === where.cashDeskId) ?? null),
      ),
    },
    transfer: {
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.pendingSum ?? 0 } }),
      findUnique: jest.fn().mockResolvedValue(opts.transfer ?? null),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 10, ...data })),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 10, ...data })),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Тест' }) },
    notification: { create: jest.fn().mockResolvedValue({}) },
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 1n }]),
  };
}

describe('TransfersService — серверні правила', () => {
  describe('create()', () => {
    const dto = { fromDeskId: 1, toDeskId: 2, currency: 'UAH', amount: 300 };

    it('відправляє зі своєї каси при достатній готівці', async () => {
      const service = new TransfersService(makePrisma() as any);
      const res: any = await service.create(dto, 5, CASHIER);
      expect(res.status).toBe('PENDING');
    });

    it('блокує відправку з ЧУЖОЇ каси', async () => {
      const service = new TransfersService(makePrisma() as any);
      // userId=7 — касир каси 2, а відправляє з каси 1
      await expect(service.create(dto, 7, { sub: 7, role: 'CASHIER' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('блокує відправку без відкритої зміни на касі-відправнику', async () => {
      const service = new TransfersService(makePrisma({ shifts: [toShift] }) as any);
      await expect(service.create(dto, 5, CASHIER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('блокує відправку понад готівку каси', async () => {
      const service = new TransfersService(makePrisma() as any);
      await expect(service.create({ ...dto, amount: 5000 }, 5, CASHIER))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('PENDING-передачі резервують готівку (двічі ті самі гроші не відправиш)', async () => {
      // У касі 1000, у дорозі (PENDING) вже 800 → доступно 200, а шлемо 300.
      const service = new TransfersService(makePrisma({ pendingSum: 800 }) as any);
      await expect(service.create(dto, 5, CASHIER)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('confirm() / reject()', () => {
    const pendingTransfer = {
      id: 10, status: 'PENDING', fromDeskId: 1, toDeskId: 2,
      currency: 'UAH', amount: 300, counterCurrency: null, counterAmount: null,
      sentBy: { id: 5, name: 'Відправник' }, toDesk: { exchangePoint: { name: 'Точка 2' } },
    };

    it('отримувач підтверджує; сторонній касир — ні', async () => {
      const ok = new TransfersService(makePrisma({ transfer: pendingTransfer }) as any);
      await expect(ok.confirm(10, 7, { sub: 7, role: 'CASHIER' })).resolves.toBeDefined();

      const stranger = new TransfersService(makePrisma({ transfer: pendingTransfer }) as any);
      await expect(stranger.confirm(10, 5, CASHIER)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('адмін може підтвердити будь-яку передачу', async () => {
      const service = new TransfersService(makePrisma({ transfer: pendingTransfer }) as any);
      await expect(service.confirm(10, 99, ADMIN)).resolves.toBeDefined();
    });

    it('своп: блокує підтвердження без достатньої зустрічної валюти', async () => {
      // Отримувач має 50 USD, а своп вимагає віддати 100 USD.
      const swap = { ...pendingTransfer, counterCurrency: 'USD', counterAmount: 100 };
      const service = new TransfersService(makePrisma({ transfer: swap }) as any);
      await expect(service.confirm(10, 7, { sub: 7, role: 'CASHIER' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('відхилити може лише отримувач', async () => {
      const stranger = new TransfersService(makePrisma({ transfer: pendingTransfer }) as any);
      await expect(stranger.reject(10, 5, 'не мої', CASHIER)).rejects.toBeInstanceOf(BadRequestException);

      const ok = new TransfersService(makePrisma({ transfer: pendingTransfer }) as any);
      await expect(ok.reject(10, 7, 'помилкова', { sub: 7, role: 'CASHIER' })).resolves.toBeDefined();
    });
  });
});
