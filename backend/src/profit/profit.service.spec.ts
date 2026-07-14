import { ProfitService } from './profit.service';

/**
 * Регресія: нульова перенесена собівартість = слід ПОВНІСТЮ закритої позиції,
 * а не реальна ціна. Якщо валюта потім з'являється в касі без купівлі
 * (підкріплення, передача, коригування), нуль дав би фантомний прибуток на всю
 * суму продажу — саме той «плюс, якого немає в реалії».
 */
function build(basisRows: { currency: string; avgCost: number }[], rates: { currency: string; buy: number }[]) {
  const upserts: any[] = [];
  const prisma: any = {
    deskCostBasis: {
      findMany: jest.fn().mockResolvedValue(basisRows),
      upsert: jest.fn((args: any) => { upserts.push(args); return Promise.resolve({}); }),
    },
    rate: { findMany: jest.fn().mockResolvedValue(rates) },
    $transaction: (arr: any[]) => Promise.all(arr),
  };
  return { service: new ProfitService(prisma), upserts };
}

describe('ProfitService — перенесена собівартість', () => {
  const sellOp = (amount: number, rate: number) => ({
    type: 'SELL', currency: 'EUR', amount, totalUah: amount * rate, createdAt: new Date(),
  });

  it('нульова собівартість у базі НЕ дає фантомного прибутку — падаємо на курс купівлі', async () => {
    // Каса вчора розпродала весь EUR → у DeskCostBasis лишився нуль (історичні дані).
    const { service } = build([{ currency: 'EUR', avgCost: 0 }], [{ currency: 'EUR', buy: 51.0 }]);

    // Сьогодні 500 EUR приїхали підкріпленням (є в startBalance, купівлі не було)
    // і продані по 51.5.
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 500 },
      operations: [sellOp(500, 51.5)],
    });

    // Проти курсу купівлі 51.0: 500 × 0.5 = 250. НЕ 25 750 (уся сума продажу).
    expect(res.totalRealized).toBeCloseTo(250, 2);
  });

  it('реальна перенесена собівартість використовується (не підмінюється курсом)', async () => {
    const { service } = build([{ currency: 'EUR', avgCost: 50.0 }], [{ currency: 'EUR', buy: 51.0 }]);
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 500 },
      operations: [sellOp(500, 51.5)],
    });
    expect(res.totalRealized).toBeCloseTo(500 * (51.5 - 50.0), 2); // 750, а не 250
  });

  it('saveBasis не записує нульову собівартість закритої позиції', async () => {
    const { service, upserts } = build([], []);
    await service.saveBasis(1, {
      EUR: { qty: 0, avgCost: 0 },    // позиція закрита — не зберігати
      USD: { qty: 100, avgCost: 44.5 }, // відкрита — зберегти
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].where.cashDeskId_currency.currency).toBe('USD');
  });

  it('USDT не створює позиції каси (живе в окремому гаманці)', async () => {
    const { service } = build([], [{ currency: 'USDT', buy: 44.5 }]);
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { USDT: 796 }, // історичний хвіст у готівковому балансі
      operations: [],
    });
    expect(res.ending.USDT).toBeUndefined();
  });
});

/**
 * Регресія: валюта, що приїхала ПІДКРІПЛЕННЯМ або ПЕРЕДАЧЕЮ, має входити в
 * WAC-позицію (за курсом купівлі точки). Інакше її продаж відкривав коротку
 * позицію: прибуток = 0, а перенесена собівартість підмінялась ціною ПРОДАЖУ —
 * і наступна зміна рахувала прибуток проти безглуздої бази.
 */
describe('ProfitService — неторгові рухи валюти в позиції', () => {
  function svc(basisRows: any[], rates: any[], transfers: any[] = []) {
    const prisma: any = {
      deskCostBasis: { findMany: jest.fn().mockResolvedValue(basisRows), upsert: jest.fn() },
      rate: { findMany: jest.fn().mockResolvedValue(rates) },
      transfer: { findMany: jest.fn().mockResolvedValue(transfers) },
      $transaction: (arr: any[]) => Promise.all(arr),
    };
    return new ProfitService(prisma);
  }
  const t = (min: number) => new Date(Date.UTC(2026, 6, 14, 8, min));

  it('продаж ПІДКРІПЛЕНОЇ валюти дає прибуток проти курсу купівлі, а не 0', async () => {
    const service = svc([{ currency: 'USD', avgCost: 44.0 }], [{ currency: 'USD', buy: 44.0 }]);
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { USD: 0 },
      // 08:00 підкріплення 5000 USD → 08:10 продаж 3000 по 44.85
      cashMovements: [{ direction: 'IN', currency: 'USD', amount: 5000, createdAt: t(0) } as any],
      operations: [
        { type: 'SELL', currency: 'USD', amount: 3000, totalUah: 3000 * 44.85, createdAt: t(10) } as any,
      ],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo(3000 * (44.85 - 44.0), 2); // 2550, а не 0
    expect(res.ending.USD.qty).toBeCloseTo(2000, 6);   // позиція ДОВГА (2000), не коротка
    expect(res.ending.USD.avgCost).toBeCloseTo(44.0, 6); // собівартість не підмінилась ціною продажу
  });

  it('продаж валюти з ОТРИМАНОЇ ПЕРЕДАЧІ так само входить у позицію', async () => {
    const service = svc(
      [{ currency: 'EUR', avgCost: 51.0 }],
      [{ currency: 'EUR', buy: 51.0 }],
      [{ currency: 'EUR', amount: 1000, fromDeskId: 9, toDeskId: 1, counterCurrency: null, counterAmount: null, confirmedAt: t(5) }],
    );
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 0 },
      operations: [
        { type: 'SELL', currency: 'EUR', amount: 1000, totalUah: 1000 * 51.6, createdAt: t(20) } as any,
      ],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo(1000 * (51.6 - 51.0), 2); // 600, а не 0
    expect(res.ending.EUR.qty).toBeCloseTo(0, 6);
  });

  it('інкасація зменшує запас, але прибутку не дає і не змінює собівартість', async () => {
    const service = svc([{ currency: 'USD', avgCost: 44.0 }], [{ currency: 'USD', buy: 44.5 }]);
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { USD: 1000 },
      cashMovements: [{ direction: 'OUT', currency: 'USD', amount: 400, createdAt: t(5) } as any],
      operations: [],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo(0, 6);
    expect(res.ending.USD.qty).toBeCloseTo(600, 6);
    expect(res.ending.USD.avgCost).toBeCloseTo(44.0, 6);
  });

  it('порядок важливий: продаж ДО підкріплення все ще відкриває коротку (це фізично так і є)', async () => {
    const service = svc([{ currency: 'USD', avgCost: 44.0 }], [{ currency: 'USD', buy: 44.0 }]);
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { USD: 0 },
      // Спершу продали (в борг), потім підкріпили — підкріплення гасить борг без прибутку.
      cashMovements: [{ direction: 'IN', currency: 'USD', amount: 3000, createdAt: t(30) } as any],
      operations: [
        { type: 'SELL', currency: 'USD', amount: 3000, totalUah: 3000 * 44.85, createdAt: t(10) } as any,
      ],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo(0, 6); // продаж без запасу — прибуток лише при відкупі
    expect(res.ending.USD.qty).toBeCloseTo(0, 6); // підкріплення закрило коротку позицію
  });
});
