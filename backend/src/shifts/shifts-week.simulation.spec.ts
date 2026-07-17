import { ShiftsService } from './shifts.service';
import { ProfitService } from '../profit/profit.service';

/**
 * Симуляція ТИЖНЯ роботи однієї каси з закриттям кожної зміни ($-числовник).
 *
 * Навіщо: прибуток рахується за моделлю «каса в доларах» із ПЕРЕХІДНОЮ
 * собівартістю (сер. курс гривні + $-кроси валют) — помилки в перенесенні
 * basis/залишку між змінами не видно в юніт-тестах однієї зміни. Тут стан
 * переноситься як у проді: endBalance закритої зміни → startBalance наступної,
 * DeskCostBasis → відкриваюча собівартість.
 *
 * Ключові властивості моделі (рішення власника 2026-07-17):
 *   • продаж USD прибутку НЕ дає — він формує базу гривні (сер. курс);
 *   • прибуток реалізується на ВІДКУПІ (купівля USD дешевше за базу);
 *   • валюти несуть $-крос; USD — числовник без позиції.
 *
 * Курси точки незмінні весь тиждень: USD 44.50/45.00 (S=45), EUR 51.30/51.60.
 */

function makeWorld(rates: { currency: string; buy: number; sell: number }[]) {
  const basis = new Map<string, number>(); // DeskCostBasis: currency → avgCost (людський формат)
  let shift: any = null;
  let transfers: any[] = [];
  const rateRows = rates.map((r) => ({ ...r, createdAt: new Date(0) }));

  const prisma: any = {
    shift: {
      findUnique: jest.fn(() => Promise.resolve(shift)),
      update: jest.fn(({ data }: any) => {
        Object.assign(shift, data);
        return Promise.resolve({ ...shift });
      }),
    },
    // where-свідомий мок: getUsdTimeline фільтрує по currency='USD'.
    rate: {
      findMany: jest.fn((args: any) => {
        const cur = args?.where?.currency;
        return Promise.resolve((cur ? rateRows.filter((r) => r.currency === cur) : rateRows).map((r) => ({ ...r })));
      }),
    },
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
    operation: {
      update: jest.fn(({ where, data }: any) => {
        const op = shift.operations.find((o: any) => o.id === where.id);
        if (op) { op.profit = data.profit; op.profitUsd = data.profitUsd; }
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
      cashMovements: (params.cashMovements ?? []).map((m) => ({ createdAt: stamp(), ...m })),
      usdtOperations: [],
      cashDesk: { exchangePointId: 1 },
    };
    return service.closeShift(shift.id, params.endBalance);
  };

  return {
    runDay, buy, sell,
    basisOf: (cur: string) => basis.get(cur),
    setTransfers: (rows: any[]) => { transfers = rows; },
    lastOps: () => shift.operations as any[],
  };
}

describe('Симуляція тижня роботи каси ($-числовник, перехідна собівартість)', () => {
  const world = makeWorld([
    { currency: 'USD', buy: 44.5, sell: 45.0 },
    { currency: 'EUR', buy: 51.3, sell: 51.6 },
  ]);
  const weekUah: number[] = [];
  const weekUsd: number[] = [];

  it('Пн (коло власника): продаж USD → 0, відкуп дешевше → +400 ₴ (8.89 $)', async () => {
    const res: any = await world.runDay({
      startBalance: { USD: 2000 },
      operations: [world.sell('USD', 1000, 45.0), world.buy('USD', 1000, 44.6)],
      endBalance: { USD: 2000, UAH: 400 },
    });
    expect(Number(res.profitUsd)).toBeCloseTo(1000 - 44600 / 45, 4); // ≈ 8.889 $
    expect(Number(res.profit)).toBeCloseTo(400, 2);
    expect(Number(res.factualProfit)).toBeCloseTo(400, 2);
    expect(res.calcBalance).toEqual({ USD: 2000, UAH: 400 });
    // Прибуток кожної операції збережено: продаж 0, відкуп 400 ₴.
    const opProfits = world.lastOps().map((o) => o.profit);
    expect(opProfits[0]).toBeCloseTo(0, 6);
    expect(opProfits[1]).toBeCloseTo(400, 2);
    // Сер. курс гривні = курс фактичного продажу; USD (числовник) бази не має.
    expect(world.basisOf('UAH')).toBeCloseTo(45.0, 6);
    expect(world.basisOf('USD')).toBeUndefined();
    weekUah.push(Number(res.profit)); weekUsd.push(Number(res.profitUsd));
  });

  it('Вт: сер. курс переноситься — відкуп наступного дня реалізує проти НЬОГО', async () => {
    const res: any = await world.runDay({
      startBalance: { USD: 2000, UAH: 400 },
      operations: [world.sell('USD', 500, 45.0), world.buy('USD', 500, 44.55)],
      endBalance: { USD: 2000, UAH: 625 },
    });
    // Відкуп 500 по 44.55 проти перенесеної бази 45: 500 − 22275/45 = 5 $ (225 ₴).
    expect(Number(res.profitUsd)).toBeCloseTo(5, 4);
    expect(Number(res.profit)).toBeCloseTo(225, 2);
    expect(world.basisOf('UAH')).toBeCloseTo(45.0, 6);
    weekUah.push(Number(res.profit)); weekUsd.push(Number(res.profitUsd));
  });

  it('Ср: купівля євро за гривню — БЕЗ прибутку, крос = 51.30/45 = 1.14', async () => {
    const res: any = await world.runDay({
      startBalance: { USD: 2000, UAH: 625 },
      cashMovements: [{ direction: 'IN', currency: 'UAH', amount: 60000 }],
      operations: [world.buy('EUR', 1000, 51.3)],
      endBalance: { USD: 2000, UAH: 9325, EUR: 1000 },
    });
    expect(Number(res.profit)).toBeCloseTo(0, 6);      // купівля товару — ще не заробіток
    expect(res.calcBalance).toEqual({ USD: 2000, UAH: 9325, EUR: 1000 });
    expect(world.basisOf('EUR')).toBeCloseTo(1.14, 6); // $-крос — число власника
    expect(world.basisOf('UAH')).toBeCloseTo(45.0, 6); // підкріплення не зламало базу
    expect(res.netCashMovements).toEqual({ UAH: 60000 });
    weekUah.push(Number(res.profit)); weekUsd.push(Number(res.profitUsd));
  });

  it('Чт (приклад №2 власника): продаж євро проти кросу + відкуп гривні', async () => {
    const res: any = await world.runDay({
      startBalance: { USD: 2000, UAH: 9325, EUR: 1000 },
      operations: [world.sell('EUR', 1000, 51.6), world.buy('USD', 1000, 44.5)],
      endBalance: { USD: 3000, UAH: 16425, EUR: 0 },
    });
    // EUR: 1000 × (51.60/45 − 1.14) ≈ 6.67 $ (300 ₴); відкуп: 1000 − 44500/45 ≈ 11.11 $ (500 ₴).
    expect(Number(res.profitUsd)).toBeCloseTo(1000 * (51.6 / 45 - 1.14) + (1000 - 44500 / 45), 4);
    expect(Number(res.profit)).toBeCloseTo(800, 2);
    expect(res.profitByCurrency.EUR).toBeCloseTo(300, 2);
    expect(res.profitByCurrency.USD).toBeCloseTo(500, 2);
    // Позиція EUR закрита — крос лишається як остання відома ціна.
    expect(world.basisOf('EUR')).toBeCloseTo(1.14, 6);
    weekUah.push(Number(res.profit)); weekUsd.push(Number(res.profitUsd));
  });

  it('Пт: передача +1000 USD рухає залишок, але НЕ прибуток', async () => {
    world.setTransfers([
      { currency: 'USD', amount: 1000, fromDeskId: 9, toDeskId: 7, counterCurrency: null, counterAmount: null, confirmedAt: new Date(Date.UTC(2026, 6, 10)) },
    ]);
    const res: any = await world.runDay({
      startBalance: { USD: 3000, UAH: 16425 },
      operations: [],
      endBalance: { USD: 4000, UAH: 16425 },
    });
    expect(res.calcBalance).toEqual({ USD: 4000, UAH: 16425 });
    expect(Number(res.profit)).toBeCloseTo(0, 6);
    expect(Number(res.factualProfit)).toBeCloseTo(0, 6);
    expect(res.netTransfers).toEqual({ USD: 1000 });
    world.setTransfers([]);
    weekUah.push(Number(res.profit)); weekUsd.push(Number(res.profitUsd));
  });

  it('Сб (приклад №6 власника): продаж запасу — 0; нестача касира — лише у фактичному', async () => {
    const res: any = await world.runDay({
      startBalance: { USD: 4000, UAH: 16425 },
      operations: [world.sell('USD', 500, 45.0)],
      // Розрахунково USD 3500, касир нарахував 3490 → нестача 10 USD.
      endBalance: { USD: 3490, UAH: 38925 },
    });
    // Продаж прибутку не дає (це стара WAC давала б +250) — гроші ще «не на місці».
    expect(Number(res.profit)).toBeCloseTo(0, 6);
    // Нестача 10 USD за курсом продажу: −450 ₴ = −10 $.
    expect(Number(res.factualProfit)).toBeCloseTo(-450, 2);
    expect(Number(res.factualProfitUsd)).toBeCloseTo(-10, 4);
    weekUah.push(Number(res.profit)); weekUsd.push(Number(res.profitUsd));
  });

  it('Нд: сторно не рахується; відкуп реалізує; «каса в доларах» зберігається', async () => {
    const res: any = await world.runDay({
      startBalance: { USD: 3490, UAH: 38925 },
      operations: [world.sell('USD', 200, 45.0, true), world.buy('USD', 200, 44.6)],
      endBalance: { USD: 3690, UAH: 30005 },
    });
    // Сторнованій операції прибуток записано нулем; відкуп: 200 − 8920/45 ≈ 1.78 $ (80 ₴).
    expect(world.lastOps()[0].profit).toBe(0);
    expect(Number(res.profit)).toBeCloseTo(80, 2);
    // «Каса в доларах» на закритті: 3690 + 30005/45.
    expect(res.tillUsd.total).toBeCloseTo(3690 + 30005 / 45, 2);
    expect(res.tillUsd.byCurrency.UAH).toBeCloseTo(30005 / 45, 2);
    weekUah.push(Number(res.profit)); weekUsd.push(Number(res.profitUsd));
  });

  it('ІНВАРІАНТ тижня: приріст доларової вартості каси = Σ прибутків + вливання − нестача', () => {
    expect(weekUah).toHaveLength(7);
    // ₴: 400 + 225 + 0 + 800 + 0 + 0 + 80 = 1505; $ = 1505/45 (курс незмінний).
    const totalUah = weekUah.reduce((a, v) => a + v, 0);
    const totalUsd = weekUsd.reduce((a, v) => a + v, 0);
    expect(totalUah).toBeCloseTo(1505, 2);
    expect(totalUsd).toBeCloseTo(1505 / 45, 4);
    // Каса: старт 2000 $ (2000 USD) → фінал 3690 + 30005/45 ≈ 4356.78 $.
    // Вливання: підкріплення 60000₴/45 ≈ 1333.33 $ + передача 1000 $; нестача −10 $.
    const startValue = 2000;
    const endValue = 3690 + 30005 / 45;
    const inflows = 60000 / 45 + 1000;
    const shortage = -10;
    expect(endValue).toBeCloseTo(startValue + inflows + shortage + totalUsd, 2);
  });
});
