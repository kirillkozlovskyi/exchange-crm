import { ShiftsService } from './shifts.service';
import { ProfitService } from '../profit/profit.service';

/**
 * Симуляція ТИЖНЯ роботи однієї каси з закриттям кожної зміни.
 *
 * Навіщо: прибуток рахується за WAC із ПЕРЕХІДНОЮ собівартістю (Варіант 1) —
 * помилки в перенесенні basis/залишку між змінами не видно в юніт-тестах
 * однієї зміни. Тут стан переноситься як у проді: endBalance закритої зміни →
 * startBalance наступної, DeskCostBasis → відкриваюча собівартість.
 *
 * Курси точки незмінні весь тиждень: USD 41.0/41.6 (mid 41.3), EUR 45.0/45.8.
 */

function makeWorld(rates: { currency: string; buy: number; sell: number }[]) {
  const basis = new Map<string, number>(); // DeskCostBasis: currency → avgCost
  const soldPool = new Map<string, { units: number; uah: number }>(); // DeskSoldPool
  let shift: any = null;
  let transfers: any[] = [];

  const prisma: any = {
    shift: {
      findUnique: jest.fn(() => Promise.resolve(shift)),
      update: jest.fn(({ data }: any) => {
        Object.assign(shift, data);
        return Promise.resolve({ ...shift });
      }),
    },
    rate: { findMany: jest.fn(() => Promise.resolve(rates.map((r) => ({ ...r })))) },
    // Мок чутливий до статусу: перевірка непідтверджених передач (PENDING) при
    // закритті зміни має бачити порожньо — тут усі передачі вже підтверджені.
    transfer: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(where?.status === 'PENDING' ? [] : transfers),
      ),
    },
    deskCostBasis: {
      findMany: jest.fn(() =>
        Promise.resolve([...basis].map(([currency, avgCost]) => ({ currency, avgCost }))),
      ),
      upsert: jest.fn(({ create }: any) => {
        basis.set(create.currency, Number(create.avgCost));
        return Promise.resolve({});
      }),
    },
    // Пул проданої гривні (маржа з відкупу) — переноситься між змінами, як і basis.
    deskSoldPool: {
      findMany: jest.fn(() =>
        Promise.resolve([...soldPool].map(([currency, p]) => ({ currency, ...p }))),
      ),
      upsert: jest.fn(({ create }: any) => {
        soldPool.set(create.currency, { units: Number(create.units), uah: Number(create.uah) });
        return Promise.resolve({});
      }),
    },
    operation: {
      update: jest.fn(({ where, data }: any) => {
        const op = shift.operations.find((o: any) => o.id === where.id);
        if (op) op.profit = data.profit;
        return Promise.resolve(op);
      }),
    },
    $transaction: (arr: any[]) => Promise.all(arr),
  };

  const service = new ShiftsService(prisma, new ProfitService(prisma));

  let shiftSeq = 0;
  let opSeq = 0;
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 6, 6) + ++tick * 60_000);

  const buy = (currency: string, amount: number, rate: number) => ({
    id: ++opSeq, type: 'BUY', currency, amount, totalUah: amount * rate,
    payCurrency: null, payAmount: null, cancelled: false, createdAt: stamp(),
  });
  const sell = (currency: string, amount: number, rate: number, cancelled = false) => ({
    id: ++opSeq, type: 'SELL', currency, amount, totalUah: amount * rate,
    payCurrency: null, payAmount: null, cancelled, createdAt: stamp(),
  });
  // Крос: клієнт дає payAmount payCurrency, отримує amount currency; totalUah — обидва плеча.
  const cross = (currency: string, amount: number, payCurrency: string, payAmount: number, totalUah: number) => ({
    id: ++opSeq, type: 'EXCHANGE', currency, amount, totalUah,
    payCurrency, payAmount, cancelled: false, createdAt: stamp(),
  });

  /** Відкриває зміну дня і одразу закриває її з переданим фактичним залишком. */
  const runDay = async (params: {
    startBalance: Record<string, number>;
    operations?: any[];
    cashMovements?: any[];
    endBalance?: Record<string, number>; // без нього factualEnd = calcBalance
  }) => {
    shift = {
      id: ++shiftSeq, status: 'OPEN', cashDeskId: 7, openedAt: stamp(),
      startBalance: params.startBalance,
      operations: params.operations ?? [],
      cashMovements: params.cashMovements ?? [],
      usdtOperations: [],
      cashDesk: { exchangePointId: 1 },
    };
    return service.closeShift(shift.id, params.endBalance);
  };

  return {
    runDay, buy, sell, cross,
    basisOf: (cur: string) => basis.get(cur),
    setTransfers: (rows: any[]) => { transfers = rows; },
    lastOps: () => shift.operations as any[],
  };
}

describe('Симуляція тижня роботи каси (WAC із перехідною собівартістю)', () => {
  const world = makeWorld([
    { currency: 'USD', buy: 41.0, sell: 41.6 }, // mid 41.3
    { currency: 'EUR', buy: 45.0, sell: 45.8 }, // mid 45.4
  ]);
  const weekProfits: number[] = [];

  it('Пн: купівля + частковий продаж — прибуток лише з проданого, решта переноситься за собівартістю', async () => {
    const res: any = await world.runDay({
      startBalance: { UAH: 100000 },
      operations: [world.buy('USD', 1000, 41.0), world.sell('USD', 400, 41.6)],
      endBalance: { UAH: 75640, USD: 600 },
    });
    // Продано 400 проти собівартості 41.0: 400 × 0.6 = 240. Непродані 600 не переоцінюються.
    expect(Number(res.profit)).toBeCloseTo(240, 6);
    expect(Number(res.factualProfit)).toBeCloseTo(240, 6);
    expect(res.calcBalance).toEqual({ UAH: 75640, USD: 600 });
    // Прибуток кожної операції збережено (для фінансів): купівля 0, продаж 240.
    const opProfits = world.lastOps().map((o) => o.profit);
    expect(opProfits[0]).toBeCloseTo(0, 6);
    expect(opProfits[1]).toBeCloseTo(240, 6);
    // Собівартість перенесено на завтра.
    expect(world.basisOf('USD')).toBeCloseTo(41.0, 6);
    weekProfits.push(Number(res.profit));
  });

  it('Вт: сценарій власника — продаж УЧОРАШНЬОГО запасу дає прибуток одразу, без купівлі сьогодні', async () => {
    const res: any = await world.runDay({
      startBalance: { UAH: 75640, USD: 600 },
      operations: [world.sell('USD', 600, 41.7)],
      endBalance: { UAH: 100660, USD: 0 },
    });
    // 600 × (41.7 − перенесена собівартість 41.0) = 420.
    expect(Number(res.profit)).toBeCloseTo(420, 6);
    expect(Number(res.factualProfit)).toBeCloseTo(420, 6);
    weekProfits.push(Number(res.profit));
  });

  it('Ср: дві купівлі за різними цінами → зважена середня собівартість', async () => {
    const res: any = await world.runDay({
      startBalance: { UAH: 100660 },
      operations: [
        world.buy('USD', 500, 41.2),
        world.buy('USD', 500, 41.4),
        world.sell('USD', 300, 41.9),
      ],
      endBalance: { UAH: 71930, USD: 700 },
    });
    // Середня (41.2+41.4)/2 = 41.3; продаж 300 × (41.9 − 41.3) = 180.
    expect(Number(res.profit)).toBeCloseTo(180, 6);
    expect(world.basisOf('USD')).toBeCloseTo(41.3, 6);
    weekProfits.push(Number(res.profit));
  });

  it('Чт: крос EUR→USD + сторно — USD-плече реалізує прибуток, скасована операція не рахується', async () => {
    const res: any = await world.runDay({
      startBalance: { UAH: 71930, USD: 700 },
      operations: [
        // Клієнт дає 104 EUR (по buy 45 → 4680 грн), отримує 112.5 USD (по sell 41.6).
        world.cross('USD', 112.5, 'EUR', 104, 4680),
        world.sell('USD', 200, 41.9, true), // сторно
        world.sell('USD', 100, 41.8),
      ],
      endBalance: { UAH: 76110, USD: 487.5, EUR: 104 },
    });
    // USD: крос 112.5×(41.6−41.3)=33.75 + продаж 100×(41.8−41.3)=50 = 83.75. EUR лише придбано.
    expect(Number(res.profit)).toBeCloseTo(83.75, 6);
    expect(res.profitByCurrency.USD).toBeCloseTo(83.75, 6);
    expect(res.profitByCurrency.EUR ?? 0).toBeCloseTo(0, 6);
    // Сторнованій операції прибуток записано нулем.
    expect(world.lastOps()[1].profit).toBe(0);
    // EUR отримали за 4680/104 = 45.0 — це його собівартість на завтра.
    expect(world.basisOf('EUR')).toBeCloseTo(45.0, 6);
    expect(world.basisOf('USD')).toBeCloseTo(41.3, 6);
    weekProfits.push(Number(res.profit));
  });

  it('Пт: передача +1000 USD та інкасація 50000 UAH рухають залишок, але НЕ прибуток', async () => {
    world.setTransfers([
      { currency: 'USD', amount: 1000, fromDeskId: 9, toDeskId: 7, counterCurrency: null, counterAmount: null },
    ]);
    const res: any = await world.runDay({
      startBalance: { UAH: 76110, USD: 487.5, EUR: 104 },
      operations: [world.sell('USD', 200, 41.9)],
      cashMovements: [{ direction: 'OUT', currency: 'UAH', amount: 50000 }],
      endBalance: { UAH: 34490, USD: 1287.5, EUR: 104 },
    });
    expect(res.calcBalance).toEqual({ UAH: 34490, USD: 1287.5, EUR: 104 });
    // Лише торговий результат: 200 × (41.9 − 41.3) = 120; передача/інкасація вилучені.
    expect(Number(res.profit)).toBeCloseTo(120, 6);
    expect(Number(res.factualProfit)).toBeCloseTo(120, 6);
    expect(res.netTransfers).toEqual({ USD: 1000 });
    expect(res.netCashMovements).toEqual({ UAH: -50000 });
    world.setTransfers([]);
    weekProfits.push(Number(res.profit));
  });

  it('Сб: нестача касира зменшує ФАКТИЧНИЙ прибуток (за курсом продажу), торговий — ні', async () => {
    const res: any = await world.runDay({
      startBalance: { UAH: 34490, USD: 1287.5, EUR: 104 },
      operations: [world.sell('USD', 100, 41.9)],
      // Розрахунково USD 1187.5, касир нарахував 1177.5 → нестача 10 USD.
      endBalance: { UAH: 38680, USD: 1177.5, EUR: 104 },
    });
    expect(Number(res.profit)).toBeCloseTo(60, 6); // 100 × 0.6
    // Нестача 10 USD оцінюється за курсом ПРОДАЖУ (41.6): 60 − 10 × 41.6 = −356.
    expect(Number(res.factualProfit)).toBeCloseTo(-356, 6);
    weekProfits.push(Number(res.profit));
  });

  it('Нд: розпродаж усього запасу — прибуток проти перенесеної собівартості, позиції закриті', async () => {
    // Старт — з ФАКТИЧНОГО (нарахованого) залишку суботи, як у проді.
    const res: any = await world.runDay({
      startBalance: { UAH: 38680, USD: 1177.5, EUR: 104 },
      operations: [world.sell('USD', 1177.5, 42.0), world.sell('EUR', 104, 45.9)],
      endBalance: { UAH: 92908.6, USD: 0, EUR: 0 },
    });
    // USD: 1177.5 × (42 − 41.3) = 824.25; EUR: 104 × (45.9 − 45.0) = 93.6.
    expect(Number(res.profit)).toBeCloseTo(917.85, 6);
    expect(res.profitByCurrency.USD).toBeCloseTo(824.25, 6);
    expect(res.profitByCurrency.EUR).toBeCloseTo(93.6, 6);
    weekProfits.push(Number(res.profit));
  });

  it('Підсумок тижня: сума прибутків змін відповідає очікуваній', () => {
    expect(weekProfits).toHaveLength(7);
    const total = weekProfits.reduce((a, v) => a + v, 0);
    // 240 + 420 + 180 + 83.75 + 120 + 60 + 917.85
    expect(total).toBeCloseTo(2021.6, 6);
  });
});
