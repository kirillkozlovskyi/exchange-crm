import { buybackMargin, applyBuyback, SoldPoolMap, SoldPool } from './buyback-margin.util';

const op = (o: Partial<Record<string, unknown>>) => ({ currency: 'USD', amount: 0, totalUah: 0, ...o });

describe('buyback-margin: маржа з відкупу (модель замовника)', () => {
  it('продаж САМ ПО СОБІ маржі не дає — лише наповнює пул гривні', () => {
    const r = buybackMargin({}, [op({ type: 'SELL', amount: 1000, totalUah: 1000 * 44.8 })]);
    expect(r.totalMargin).toBeCloseTo(0, 6);
    expect(r.ending.USD.units).toBeCloseTo(1000, 6);
    expect(r.ending.USD.uah).toBeCloseTo(44800, 6);
  });

  it('відкуп дешевше за курс продажу дає маржу («кільце» замкнулось)', () => {
    // Продали 1000 по 44.80, відкупили 1000 по 44.60 → 1000 × 0.20 = 200.
    const r = buybackMargin({}, [
      op({ type: 'SELL', amount: 1000, totalUah: 1000 * 44.8 }),
      op({ type: 'BUY', amount: 1000, totalUah: 1000 * 44.6 }),
    ]);
    expect(r.perOp[0]).toBeCloseTo(0, 6);
    expect(r.perOp[1]).toBeCloseTo(200, 6);
    expect(r.ending.USD.units).toBeCloseTo(0, 6);
  });

  it('відкуп дорожче за курс продажу дає МІНУС (сценарій замовника: 44.63 → 44.84)', () => {
    const r = buybackMargin({}, [
      op({ type: 'SELL', amount: 1000, totalUah: 1000 * 44.63 }),
      op({ type: 'BUY', amount: 1000, totalUah: 1000 * 44.84 }),
    ]);
    expect(r.totalMargin).toBeCloseTo(1000 * (44.63 - 44.84), 6); // −210
  });

  it('купівля понад пул маржі не дає — відкуповувати нічого', () => {
    // Продали 100, відкупили 300: маржа лише зі 100; решта 200 — просто запас.
    const r = buybackMargin({}, [
      op({ type: 'SELL', amount: 100, totalUah: 100 * 44.8 }),
      op({ type: 'BUY', amount: 300, totalUah: 300 * 44.6 }),
    ]);
    expect(r.totalMargin).toBeCloseTo(100 * 0.2, 6);
    expect(r.ending.USD.units).toBeCloseTo(0, 6);
  });

  it('пул переноситься між змінами: продаж учора → відкуп сьогодні дає маржу', () => {
    const opening: SoldPoolMap = { USD: { units: 5000, uah: 5000 * 44.7 } };
    const r = buybackMargin(opening, [op({ type: 'BUY', amount: 5000, totalUah: 5000 * 44.6 })]);
    expect(r.totalMargin).toBeCloseTo(5000 * 0.1, 6); // 500
  });

  it('частковий відкуп: курс решти пулу не змінюється', () => {
    const opening: SoldPoolMap = { USD: { units: 1000, uah: 1000 * 44.8 } };
    const r = buybackMargin(opening, [op({ type: 'BUY', amount: 400, totalUah: 400 * 44.6 })]);
    expect(r.totalMargin).toBeCloseTo(400 * 0.2, 6);
    expect(r.ending.USD.units).toBeCloseTo(600, 6);
    expect(r.ending.USD.uah / r.ending.USD.units).toBeCloseTo(44.8, 6);
  });

  it('сторновані операції ігноруються', () => {
    const r = buybackMargin({ USD: { units: 100, uah: 100 * 44.8 } }, [
      op({ type: 'BUY', amount: 100, totalUah: 100 * 44.6, cancelled: true }),
    ]);
    expect(r.totalMargin).toBeCloseTo(0, 6);
    expect(r.ending.USD.units).toBeCloseTo(100, 6);
  });

  it('крос EUR→USD: віддані USD ідуть у пул, придбані EUR відкуповують пул EUR', () => {
    // Каса має відкритий пул EUR (продала 105 EUR по 45 раніше).
    const opening: SoldPoolMap = { EUR: { units: 105, uah: 105 * 45 } };
    const r = buybackMargin(opening, [
      op({ type: 'EXCHANGE', currency: 'USD', amount: 100, totalUah: 4485, payCurrency: 'EUR', payAmount: 105 }),
    ]);
    // EUR придбали за 4485/105 = 42.71 → маржа = 105 × (45 − 42.71) = 240.
    expect(r.byCurrency.EUR).toBeCloseTo(105 * (45 - 4485 / 105), 6);
    // USD віддали → пул USD наповнився, маржі поки немає.
    expect(r.byCurrency.USD ?? 0).toBeCloseTo(0, 6);
    expect(r.ending.USD.units).toBeCloseTo(100, 6);
  });

  it('applyBuyback: продаж у порожній пул, потім відкуп із перевищенням', () => {
    const pool: SoldPool = { units: 0, uah: 0 };
    expect(applyBuyback(pool, -200, 44.9)).toBeCloseTo(0, 6);
    expect(applyBuyback(pool, +500, 44.5)).toBeCloseTo(200 * 0.4, 6); // закрили лише 200
    expect(pool.units).toBeCloseTo(0, 6);
  });

  it('НАСКРІЗНИЙ приклад з анкети замовника (Пн–Чт)', () => {
    // Старт: гривня 500 000 «продана» вчора по 44.70 → пул 11 185.68 од.
    const opening: SoldPoolMap = { USD: { units: 500000 / 44.7, uah: 500000 } };
    const days = [
      // Пн: купив 5 000 @44.60, продав 8 000 @44.80 (порядок за анкетою — спершу
      // враховуємо продаж дня, як рахує замовник: він усереднив 44.70 і 44.80).
      [op({ type: 'SELL', amount: 8000, totalUah: 8000 * 44.8 }),
       op({ type: 'BUY', amount: 5000, totalUah: 5000 * 44.6 })],
      // Вт: лише продаж
      [op({ type: 'SELL', amount: 7000, totalUah: 7000 * 44.63 })],
      // Ср: купив 20 000 @44.84, продав 3 000 @44.90
      [op({ type: 'BUY', amount: 20000, totalUah: 20000 * 44.84 }),
       op({ type: 'SELL', amount: 3000, totalUah: 3000 * 44.9 })],
      // Чт: лише продаж
      [op({ type: 'SELL', amount: 15000, totalUah: 15000 * 44.7 })],
    ];

    let pool = opening;
    const perDay: number[] = [];
    for (const ops of days) {
      const r = buybackMargin(pool, ops);
      perDay.push(r.totalMargin);
      pool = r.ending;
    }

    expect(perDay[0]).toBeCloseTo(708.49, 1); // Пн: замовник назвав ≈700 (округлив курс до 44.74)
    expect(perDay[1]).toBeCloseTo(0, 6);      // Вт: лише продаж → 0 (як в анкеті)
    expect(perDay[2]).toBeCloseTo(-2704.17, 1); // Ср: відкуп 20 000 дорожче за середній курс пулу
    expect(perDay[3]).toBeCloseTo(0, 6);      // Чт: лише продаж → 0 (як в анкеті)
    const total = perDay.reduce((a, v) => a + v, 0);
    expect(total).toBeCloseTo(-1995.68, 1); // замовник назвав −1780 (інший спосіб усереднення)
  });
});
