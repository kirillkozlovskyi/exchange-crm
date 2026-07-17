import { ProfitService } from './profit.service';

/**
 * Сервісний шар $-числовника: fallback-и собівартості, неторгові рухи,
 * таймлайн курсу USD. Двигун покритий у common/wac-profit.util.spec.ts.
 */
function build(opts: {
  basisRows?: { currency: string; avgCost: number }[];
  rates?: { currency: string; buy: number; sell?: number; createdAt?: Date }[];
  transfers?: any[];
}) {
  const upserts: any[] = [];
  const rates = (opts.rates ?? []).map((r) => ({ createdAt: new Date(0), sell: 0, ...r }));
  const prisma: any = {
    deskCostBasis: {
      findMany: jest.fn().mockResolvedValue(opts.basisRows ?? []),
      upsert: jest.fn((args: any) => { upserts.push(args); return Promise.resolve({}); }),
    },
    rate: {
      // where-свідомий мок: getUsdTimeline фільтрує по currency='USD'.
      findMany: jest.fn((args: any) => {
        const cur = args?.where?.currency;
        return Promise.resolve(cur ? rates.filter((r) => r.currency === cur) : rates);
      }),
    },
    transfer: { findMany: jest.fn().mockResolvedValue(opts.transfers ?? []) },
    $transaction: (arr: any[]) => Promise.all(arr),
  };
  return { service: new ProfitService(prisma), upserts };
}

// Точка з курсом USD 44.50/45.00 — база всіх сценаріїв.
const USD_RATE = { currency: 'USD', buy: 44.5, sell: 45 };

describe('ProfitService — перенесена собівартість ($-числовник)', () => {
  const sellOp = (currency: string, amount: number, rate: number) => ({
    type: 'SELL', currency, amount, totalUah: amount * rate, createdAt: new Date(),
  });

  it('нульова собівартість у базі НЕ дає фантомного прибутку — падаємо на buy(cur)/S', async () => {
    // Каса вчора розпродала весь EUR → у DeskCostBasis лишився нуль (історичні дані).
    const { service } = build({
      basisRows: [{ currency: 'EUR', avgCost: 0 }],
      rates: [USD_RATE, { currency: 'EUR', buy: 51.0 }],
    });

    // Сьогодні 500 EUR приїхали підкріпленням (є в startBalance, купівлі не було)
    // і продані по 51.5.
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 500 },
      operations: [sellOp('EUR', 500, 51.5)],
    });

    // Проти кросу 51.0/45: 500 × (51.5−51.0)/45 ≈ 5.56 $ (250 ₴). НЕ вся сума продажу.
    expect(res.totalRealized).toBeCloseTo((500 * 0.5) / 45, 4);
    expect(res.totalRealized * 45).toBeCloseTo(250, 1);
  });

  it('реальна перенесена крос-собівартість використовується (не підмінюється курсом)', async () => {
    const { service } = build({
      basisRows: [{ currency: 'EUR', avgCost: 50.0 / 45 }], // $-крос ≈ 1.1111
      rates: [USD_RATE, { currency: 'EUR', buy: 51.0 }],
    });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 500 },
      operations: [sellOp('EUR', 500, 51.5)],
    });
    expect(res.totalRealized).toBeCloseTo((500 * (51.5 - 50.0)) / 45, 4); // ≈16.67$ (750₴)
  });

  it('продаж USD не дає прибутку, а формує базу гривні (сер. курс = курс продажу)', async () => {
    const { service } = build({ rates: [USD_RATE] });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { USD: 1000 },
      operations: [sellOp('USD', 1000, 45)],
    });
    expect(res.totalRealized).toBeCloseTo(0, 6);
    expect(res.ending.USD).toBeUndefined();             // числовник — без позиції
    expect(res.ending.UAH.qty).toBeCloseTo(45000, 6);
    expect(1 / res.ending.UAH.avgCost).toBeCloseTo(45, 6); // база 45 ₴/$
  });

  it('saveBasis: USD не пишеться, UAH інвертується в ₴/$, нулі пропускаються', async () => {
    const { service, upserts } = build({});
    await service.saveBasis(1, {
      EUR: { qty: 0, avgCost: 0 },        // позиція закрита — не зберігати
      USD: { qty: 100, avgCost: 1 },      // числовник — ніколи не зберігати
      UAH: { qty: 45000, avgCost: 1 / 44.95 }, // → 44.95 ₴/$
      PLN: { qty: 500, avgCost: 0.2628 }, // $-крос — як є
    });
    const stored = Object.fromEntries(
      upserts.map((u) => [u.where.cashDeskId_currency.currency, u.create.avgCost]),
    );
    expect(Object.keys(stored).sort()).toEqual(['PLN', 'UAH']);
    expect(stored.UAH).toBeCloseTo(44.95, 6);
    expect(stored.PLN).toBeCloseTo(0.2628, 6);
  });

  it('setBasis ігнорує USD/USDT, приймає UAH у людському форматі', async () => {
    const { service, upserts } = build({});
    await service.setBasis(1, { UAH: 44.95, EUR: 1.142, USD: 44.5, USDT: 1 });
    const stored = upserts.map((u) => u.where.cashDeskId_currency.currency).sort();
    expect(stored).toEqual(['EUR', 'UAH']);
  });

  it('USDT не створює позиції каси (живе в окремому гаманці)', async () => {
    const { service } = build({ rates: [USD_RATE, { currency: 'USDT', buy: 44.5 }] });
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
 * позицію (за кросом buy(cur)/S). Інакше її продаж відкривав коротку позицію:
 * прибуток = 0, а перенесена собівартість підмінялась ціною ПРОДАЖУ — і
 * наступна зміна рахувала прибуток проти безглуздої бази.
 */
describe('ProfitService — неторгові рухи валюти в позиції', () => {
  const t = (min: number) => new Date(Date.UTC(2026, 6, 14, 8, min));

  it('продаж ПІДКРІПЛЕНОЇ валюти дає прибуток проти кросу, а не 0', async () => {
    const { service } = build({
      basisRows: [{ currency: 'EUR', avgCost: 51.0 / 45 }],
      rates: [USD_RATE, { currency: 'EUR', buy: 51.0 }],
    });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 0 },
      // 08:00 підкріплення 5000 EUR → 08:10 продаж 3000 по 51.85
      cashMovements: [{ direction: 'IN', currency: 'EUR', amount: 5000, createdAt: t(0) } as any],
      operations: [
        { type: 'SELL', currency: 'EUR', amount: 3000, totalUah: 3000 * 51.85, createdAt: t(10) } as any,
      ],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo((3000 * (51.85 - 51.0)) / 45, 4); // ≈56.7$, а не 0
    expect(res.ending.EUR.qty).toBeCloseTo(2000, 6);   // позиція ДОВГА (2000), не коротка
    expect(res.ending.EUR.avgCost).toBeCloseTo(51.0 / 45, 6); // собівартість не підмінилась
  });

  it('продаж валюти з ОТРИМАНОЇ ПЕРЕДАЧІ так само входить у позицію', async () => {
    const { service } = build({
      basisRows: [{ currency: 'EUR', avgCost: 51.0 / 45 }],
      rates: [USD_RATE, { currency: 'EUR', buy: 51.0 }],
      transfers: [{ currency: 'EUR', amount: 1000, fromDeskId: 9, toDeskId: 1, counterCurrency: null, counterAmount: null, confirmedAt: t(5) }],
    });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 0 },
      operations: [
        { type: 'SELL', currency: 'EUR', amount: 1000, totalUah: 1000 * 51.6, createdAt: t(20) } as any,
      ],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo((1000 * (51.6 - 51.0)) / 45, 4); // ≈13.3$, а не 0
    expect(res.ending.EUR.qty).toBeCloseTo(0, 6);
  });

  it('інкасація зменшує запас, але прибутку не дає і не змінює собівартість', async () => {
    const { service } = build({
      basisRows: [{ currency: 'EUR', avgCost: 51.0 / 45 }],
      rates: [USD_RATE, { currency: 'EUR', buy: 51.5 }],
    });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 1000 },
      cashMovements: [{ direction: 'OUT', currency: 'EUR', amount: 400, createdAt: t(5) } as any],
      operations: [],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo(0, 6);
    expect(res.ending.EUR.qty).toBeCloseTo(600, 6);
    expect(res.ending.EUR.avgCost).toBeCloseTo(51.0 / 45, 6);
  });

  it('гривневе підкріплення заходить у позицію за 1/S (не ламає сер. курс)', async () => {
    const { service } = build({
      basisRows: [{ currency: 'UAH', avgCost: 44.9 }],
      rates: [USD_RATE],
    });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { UAH: 89800 },
      cashMovements: [{ direction: 'IN', currency: 'UAH', amount: 45000, createdAt: t(5) } as any],
      operations: [],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo(0, 6);
    expect(res.ending.UAH.qty).toBeCloseTo(134800, 6);
    // База: 89800@1/44.9 (2000$) + 45000@1/45 (1000$) → 134800/3000 ≈ 44.93 ₴/$.
    expect(1 / res.ending.UAH.avgCost).toBeCloseTo(134800 / 3000, 4);
  });

  it('готівка USDT-вікна рухає позицію гривні (SELL → гривня приходить)', async () => {
    const { service } = build({
      basisRows: [{ currency: 'UAH', avgCost: 44.9 }],
      rates: [USD_RATE],
    });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { UAH: 89800 },
      usdtOperations: [
        { side: 'SELL', settleCurrency: 'UAH', settleAmount: 45000, createdAt: t(5) } as any,
      ],
      operations: [],
      openedAt: t(-1),
    });
    expect(res.totalRealized).toBeCloseTo(0, 6);
    expect(res.ending.UAH.qty).toBeCloseTo(134800, 6);
  });

  it('порядок важливий: продаж ДО підкріплення все ще відкриває коротку (це фізично так і є)', async () => {
    const { service } = build({
      basisRows: [{ currency: 'EUR', avgCost: 51.0 / 45 }],
      rates: [USD_RATE, { currency: 'EUR', buy: 51.0 }],
    });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 0 },
      // Спершу продали (в борг), потім підкріпили — підкріплення гасить борг без прибутку.
      cashMovements: [{ direction: 'IN', currency: 'EUR', amount: 3000, createdAt: t(30) } as any],
      operations: [
        { type: 'SELL', currency: 'EUR', amount: 3000, totalUah: 3000 * 51.85, createdAt: t(10) } as any,
      ],
      openedAt: t(-1),
    });
    // Продаж без запасу відкрив коротку EUR за 51.85/45; підкріплення закрило її
    // без прибутку. Гривня від продажу зайшла за 1/45 (нової реалізації немає).
    expect(res.ending.EUR.qty).toBeCloseTo(0, 6);
    expect(res.totalRealized).toBeCloseTo(0, 6);
  });

  it('зміна курсу USD вдень не переписує прибуток ранніх операцій (S на момент операції)', async () => {
    const { service } = build({
      basisRows: [{ currency: 'EUR', avgCost: 1.14 }],
      rates: [
        { currency: 'USD', buy: 44.5, sell: 45, createdAt: t(0) },
        { currency: 'USD', buy: 44.4, sell: 44.9, createdAt: t(60) }, // курс змінився об 09:00
        { currency: 'EUR', buy: 51.0 },
      ],
    });
    const res = await service.computeShift({
      cashDeskId: 1, exchangePointId: 1,
      startBalance: { EUR: 2000 },
      operations: [
        // 08:10 — за S=45; 09:30 — за S=44.9.
        { type: 'SELL', currency: 'EUR', amount: 1000, totalUah: 1000 * 51.6, createdAt: t(10) } as any,
        { type: 'SELL', currency: 'EUR', amount: 1000, totalUah: 1000 * 51.6, createdAt: t(90) } as any,
      ],
      openedAt: t(1),
    });
    expect(res.sUsdPerOp[0]).toBeCloseTo(45, 6);
    expect(res.sUsdPerOp[1]).toBeCloseTo(44.9, 6);
    expect(res.perOp[0]).toBeCloseTo(1000 * (51.6 / 45 - 1.14), 4);
    expect(res.perOp[1]).toBeCloseTo(1000 * (51.6 / 44.9 - 1.14), 4);
  });
});
