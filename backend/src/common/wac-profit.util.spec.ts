import {
  wacRealized,
  wacRealizedTimeline,
  applyTrade,
  tillUsdValue,
  costToUahBasis,
  uahBasisToCost,
  PositionMap,
  WacPosition,
} from './wac-profit.util';

const op = (o: Partial<Record<string, unknown>>) => ({ currency: 'USD', amount: 0, totalUah: 0, ...o });

describe('wac-profit ($-числовник): прибуток на відкупі, гривня — позиція', () => {
  it('приклад власниці №3 (повне коло): продаж USD → 0, прибуток на ВІДКУПІ = 400₴ (8.89$)', () => {
    // Каса має 44 700 грн із базою 44.70 (₴/$).
    const opening: PositionMap = { UAH: { qty: 44700, avgCost: uahBasisToCost(44.7) } };
    const r = wacRealized(opening, [
      op({ type: 'BUY', amount: 1000, totalUah: 44700 }),  // купили 1000 USD по 44.70
      op({ type: 'SELL', amount: 1000, totalUah: 45000 }), // продали по 45.00
      op({ type: 'BUY', amount: 1000, totalUah: 44600 }),  // відкупили по 44.60
    ], 45);
    expect(r.perOp[0]).toBeCloseTo(0, 6);                 // купівля за гривню тієї ж бази
    expect(r.perOp[1]).toBeCloseTo(0, 6);                 // продаж прибутку НЕ дає
    expect(r.perOp[2]).toBeCloseTo(44600 * (1 / 44.6 - 1 / 45), 6); // ≈ +8.889$ = 400₴
    expect(r.perOp[2] * 45).toBeCloseTo(400, 1);          // у гривні — рівно як рахує власниця
    expect(r.byCurrency.USD).toBeCloseTo(r.totalRealized, 9);
    expect(r.ending.UAH.qty).toBeCloseTo(400, 6);         // виручені 400 грн лишились у позиції
  });

  it('приклад власниці №6 (стартовий залишок): продаж наявних USD дає 0, база гривні = курс продажу', () => {
    const r = wacRealized({}, [op({ type: 'SELL', amount: 1000, totalUah: 45000 })], 45);
    expect(r.totalRealized).toBeCloseTo(0, 9);
    expect(r.ending.UAH.qty).toBeCloseTo(45000, 6);
    expect(costToUahBasis(r.ending.UAH.avgCost)).toBeCloseTo(45.0, 6);
  });

  it('сер. курс гривні = середньозважений курс фактичних продажів USD (45 і 44.90 → 44.95)', () => {
    const r = wacRealized({}, [
      op({ type: 'SELL', amount: 1000, totalUah: 45000 }),
      op({ type: 'SELL', amount: 1000, totalUah: 44900 }),
    ], 45);
    expect(r.totalRealized).toBeCloseTo(0, 9);
    expect(costToUahBasis(r.ending.UAH.avgCost)).toBeCloseTo(44.95, 6); // 89900 / 2000
  });

  it('відкуп реалізує проти СЕРЕДНЬОЇ бази гривні', () => {
    const r = wacRealized({}, [
      op({ type: 'SELL', amount: 1000, totalUah: 45000 }),
      op({ type: 'SELL', amount: 1000, totalUah: 44900 }),
      op({ type: 'BUY', amount: 1000, totalUah: 44600 }), // відкуп по 44.60 проти бази 44.95
    ], 45);
    expect(r.perOp[2]).toBeCloseTo(44600 * (1 / 44.6 - 2000 / 89900), 6); // ≈ +7.786$
    expect(r.perOp[2]).toBeGreaterThan(0);
  });

  it('приклад власниці №2 (євро): реалізація проти кросу при продажу + решта на відкупі = 19.55$', () => {
    // Каса: 1000 EUR із кросом 1.14 $/€ (купили по 51.30 при базі гривні 45).
    const opening: PositionMap = { EUR: { qty: 1000, avgCost: 1.14 } };
    const r = wacRealized(opening, [
      // Продали 1000 EUR по 51.60 (S = 45): крос продажу 51.60/45 = 1.146667.
      op({ type: 'SELL', currency: 'EUR', amount: 1000, totalUah: 51600 }),
      // Відкупили долар по 44.50 усією вирученою гривнею.
      op({ type: 'BUY', currency: 'USD', amount: 51600 / 44.5, totalUah: 51600 }),
    ], 45);
    expect(r.perOp[0]).toBeCloseTo(1000 * (51.6 / 45 - 1.14), 6);        // +6.667$ на продажу EUR
    expect(r.perOp[1]).toBeCloseTo(51600 * (1 / 44.5 - 1 / 45), 6);      // +12.884$ на відкупі
    expect(r.totalRealized).toBeCloseTo(1000 * (51.6 / 44.5 - 1.14), 4); // разом 19.55$ — число власниці
    expect(r.totalRealized).toBeCloseTo(19.5506, 3);
  });

  it('приклад власниці №5 (злотий): купівля валюти за гривню — без прибутку, крос = rate/база', () => {
    const opening: PositionMap = { UAH: { qty: 100000, avgCost: uahBasisToCost(44.9) } };
    const r = wacRealized(opening, [
      op({ type: 'BUY', currency: 'PLN', amount: 5000, totalUah: 59000 }), // 5000 zł по 11.80
    ], 44.9);
    expect(r.totalRealized).toBeCloseTo(0, 9);
    expect(r.ending.PLN.qty).toBeCloseTo(5000, 6);
    expect(r.ending.PLN.avgCost).toBeCloseTo(11.8 / 44.9, 6);   // 0.262806 $/zł — число власниці
    expect(r.ending.UAH.qty).toBeCloseTo(41000, 6);
    expect(costToUahBasis(r.ending.UAH.avgCost)).toBeCloseTo(44.9, 6); // база гривні не змінилась
  });

  it('USDW («ветош») — звичайна валюта з $-кросом, USD-числовник її не торкається', () => {
    const opening: PositionMap = { UAH: { qty: 50000, avgCost: uahBasisToCost(45) } };
    const r = wacRealized(opening, [
      op({ type: 'BUY', currency: 'USDW', amount: 400, totalUah: 17800 }),  // купили по 44.50
      op({ type: 'SELL', currency: 'USDW', amount: 80, totalUah: 3588 }),   // продали по 44.85
    ], 44.95);
    expect(r.ending.USDW.avgCost).toBeCloseTo(17800 / 45 / 400, 6);         // ≈ 0.9889 $/USDW
    expect(r.perOp[1]).toBeCloseTo(80 * (44.85 / 44.95 - 17800 / 45 / 400), 6);
    expect(r.ending.USD).toBeUndefined();                                    // числовник без позиції
  });

  it('крос: віддали USD → валюта заходить за прямим курсом, без прибутку (ряд 7)', () => {
    const r = wacRealized({}, [
      op({ type: 'EXCHANGE', currency: 'USD', amount: 1000, totalUah: 45000, payCurrency: 'EUR', payAmount: 870 }),
    ], 45);
    expect(r.totalRealized).toBeCloseTo(0, 9);
    expect(r.ending.EUR.qty).toBeCloseTo(870, 6);
    expect(r.ending.EUR.avgCost).toBeCloseTo(1000 / 870, 6); // прямий крос, без S
  });

  it('крос: отримали USD → віддана валюта реалізує за прямим курсом (ряд 8)', () => {
    const opening: PositionMap = { EUR: { qty: 1000, avgCost: 1.14 } };
    const r = wacRealized(opening, [
      op({ type: 'EXCHANGE', currency: 'EUR', amount: 500, totalUah: 25800, payCurrency: 'USD', payAmount: 575 }),
    ], 45);
    expect(r.totalRealized).toBeCloseTo(500 * (575 / 500 - 1.14), 6); // +5$
    expect(r.ending.EUR.qty).toBeCloseTo(500, 6);
  });

  it('крос обох валют ≠ USD: обидва плеча оцінюються через totalUah/S (ряд 6)', () => {
    const opening: PositionMap = { EUR: { qty: 1000, avgCost: 1.14 } };
    const r = wacRealized(opening, [
      op({ type: 'EXCHANGE', currency: 'EUR', amount: 100, totalUah: 5160, payCurrency: 'PLN', payAmount: 435 }),
    ], 45);
    expect(r.perOp[0]).toBeCloseTo(100 * (5160 / 45 / 100 - 1.14), 6); // EUR реалізує
    expect(r.ending.PLN.qty).toBeCloseTo(435, 6);
    expect(r.ending.PLN.avgCost).toBeCloseTo(5160 / 45 / 435, 6);
  });

  it('старий формат BUY (cur=UAH, payCur=USD) — це відкуп: гривня реалізує (ряд 5)', () => {
    const opening: PositionMap = { UAH: { qty: 45000, avgCost: uahBasisToCost(45) } };
    const r = wacRealized(opening, [
      op({ type: 'BUY', currency: 'UAH', amount: 44600, totalUah: 44600, payCurrency: 'USD', payAmount: 1000 }),
    ], 45);
    expect(r.totalRealized).toBeCloseTo(44600 * (1 / 44.6 - 1 / 45), 6);
    expect(r.byCurrency.USD).toBeCloseTo(r.totalRealized, 9);
  });

  it('гривневі флоу: підкріплення заходить за 1/S, інкасація виходить за базою без прибутку', () => {
    const r = wacRealizedTimeline({ UAH: { qty: 45000, avgCost: uahBasisToCost(45) } }, [
      { kind: 'flow', currency: 'UAH', qty: -20000, price: 0 },        // інкасація
      { kind: 'flow', currency: 'UAH', qty: 10000, price: 1 / 44 },    // підкріплення при S=44
    ]);
    expect(r.totalRealized).toBeCloseTo(0, 9);
    expect(r.ending.UAH.qty).toBeCloseTo(35000, 6);
    // База: 25000@1/45 + 10000@1/44 середньозважено.
    const expected = (25000 * (1 / 45) + 10000 * (1 / 44)) / 35000;
    expect(r.ending.UAH.avgCost).toBeCloseTo(expected, 9);
  });

  it('скасовані (сторно) операції ігноруються', () => {
    const r = wacRealized({ UAH: { qty: 45000, avgCost: uahBasisToCost(45) } }, [
      op({ type: 'BUY', amount: 1000, totalUah: 44600, cancelled: true }),
    ], 45);
    expect(r.totalRealized).toBeCloseTo(0, 9);
    expect(r.perOp).toEqual([0]);
    expect(r.ending.UAH.qty).toBeCloseTo(45000, 6);
  });

  it('applyTrade: переворот позиції (віддали більше, ніж мали)', () => {
    const pos: WacPosition = { qty: 100, avgCost: 1.14 };
    const realized = applyTrade(pos, -150, 1.15); // віддали 150 @1.15, мали лише 100
    expect(realized).toBeCloseTo(100 * (1.15 - 1.14), 9);
    expect(pos.qty).toBeCloseTo(-50, 9);
    expect(pos.avgCost).toBeCloseTo(1.15, 9);
  });

  it('без S і без бази гривні: операція не породжує сміттєвих плечей', () => {
    const r = wacRealized({}, [op({ type: 'SELL', currency: 'EUR', amount: 100, totalUah: 5160 })], 0);
    expect(r.totalRealized).toBeCloseTo(0, 9);
    expect(r.ending.EUR).toBeUndefined();
  });
});

describe('tillUsdValue: «каса в доларах» за принципом власниці', () => {
  it('відтворює ручний підрахунок власниці (≈ 49 837 $)', () => {
    const { byCurrency, total } = tillUsdValue(
      { UAH: 727090, USD: 23209, EUR: 3200, PLN: 9200, CHF: 700, CAD: 40, USDT: 3495 },
      { UAH: 44.95, EUR: 1.142, PLN: 11.8 / 44.9, CHF: 55 / 44.9, CAD: 30 / 44.9 },
    );
    expect(byCurrency.UAH).toBeCloseTo(727090 / 44.95, 2);  // 16 175.53
    expect(byCurrency.USD).toBe(23209);
    expect(byCurrency.EUR).toBeCloseTo(3654.4, 2);
    expect(byCurrency.PLN).toBeCloseTo(2417.82, 2);
    expect(byCurrency.CHF).toBeCloseTo(857.46, 2);
    expect(byCurrency.CAD).toBeCloseTo(26.73, 2);
    expect(byCurrency.USDT).toBe(3495);
    expect(total).toBeCloseTo(49835.93, 1); // власниця округлила кожен рядок → 49 837
  });

  it('валюта без бази оцінюється в 0, а не у вигадану вартість', () => {
    const { byCurrency, total } = tillUsdValue({ GBP: 500, USD: 100 }, {});
    expect(byCurrency.GBP).toBe(0);
    expect(total).toBe(100);
  });
});
