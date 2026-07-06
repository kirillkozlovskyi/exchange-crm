import { wacRealized, applyTrade, PositionMap, WacPosition } from './wac-profit.util';

const op = (o: Partial<Record<string, unknown>>) => ({ currency: 'USD', amount: 0, totalUah: 0, ...o });

describe('wac-profit: ковзна собівартість із перехідною позицією', () => {
  it('сценарій замовника: продаж наявного USD дає прибуток одразу (проти собівартості)', () => {
    // Каса тримає 6903.08 USD, собівартість 44.00 (стартовий курс купівлі).
    const opening: PositionMap = { USD: { qty: 6903.08, avgCost: 44.0 } };
    // Продаж усіх USD по 44.85 → totalUah = 6903.08 * 44.85.
    const amount = 6903.08;
    const r = wacRealized(opening, [op({ type: 'SELL', amount, totalUah: amount * 44.85 })]);
    expect(r.totalRealized).toBeCloseTo(amount * (44.85 - 44.0), 2); // ≈ 5867.6 грн
    expect(r.ending.USD.qty).toBeCloseTo(0, 6);
  });

  it('наступний день: викуп поповнює позицію за новою собівартістю, прибутку не додає', () => {
    const opening: PositionMap = { USD: { qty: 0, avgCost: 0 } };
    const amount = 6903.08;
    const r = wacRealized(opening, [op({ type: 'BUY', amount, totalUah: amount * 44.0 })]);
    expect(r.totalRealized).toBeCloseTo(0, 6);
    expect(r.ending.USD.qty).toBeCloseTo(amount, 6);
    expect(r.ending.USD.avgCost).toBeCloseTo(44.0, 6);
  });

  it('купівля потім продаж у межах однієї зміни: прибуток = спред × к-сть', () => {
    const r = wacRealized({}, [
      op({ type: 'BUY', amount: 100, totalUah: 100 * 44.0 }),
      op({ type: 'SELL', amount: 100, totalUah: 100 * 44.85 }),
    ]);
    expect(r.totalRealized).toBeCloseTo(100 * 0.85, 6);
    expect(r.ending.USD.qty).toBeCloseTo(0, 6);
  });

  it('короткий продаж (немає запасу) → викуп дешевше реалізує прибуток', () => {
    // Продали 100 USD по 45 без запасу (позиція -100 @45), потім викупили по 44.
    const r = wacRealized({}, [
      op({ type: 'SELL', amount: 100, totalUah: 100 * 45.0 }),
      op({ type: 'BUY', amount: 100, totalUah: 100 * 44.0 }),
    ]);
    expect(r.perOp[0]).toBeCloseTo(0, 6);          // перший продаж — відкрив коротку, ще без прибутку
    expect(r.perOp[1]).toBeCloseTo(100 * (45 - 44), 6); // викуп нижче → +100
    expect(r.totalRealized).toBeCloseTo(100, 6);
    expect(r.ending.USD.qty).toBeCloseTo(0, 6);
  });

  it('часткове закриття: продаж половини запасу реалізує половину спреду', () => {
    const opening: PositionMap = { USD: { qty: 200, avgCost: 44.0 } };
    const r = wacRealized(opening, [op({ type: 'SELL', amount: 100, totalUah: 100 * 44.85 })]);
    expect(r.totalRealized).toBeCloseTo(100 * 0.85, 6);
    expect(r.ending.USD.qty).toBeCloseTo(100, 6);
    expect(r.ending.USD.avgCost).toBeCloseTo(44.0, 6); // собівартість решти не змінилась
  });

  it('усереднення собівартості: дві купівлі за різними цінами', () => {
    const r = wacRealized({}, [
      op({ type: 'BUY', amount: 100, totalUah: 100 * 44.0 }),
      op({ type: 'BUY', amount: 100, totalUah: 100 * 45.0 }),
    ]);
    expect(r.ending.USD.qty).toBeCloseTo(200, 6);
    expect(r.ending.USD.avgCost).toBeCloseTo(44.5, 6);
    expect(r.totalRealized).toBeCloseTo(0, 6);
  });

  it('скасовані (сторно) операції ігноруються', () => {
    const r = wacRealized({ USD: { qty: 100, avgCost: 44 } }, [
      op({ type: 'SELL', amount: 100, totalUah: 100 * 45, cancelled: true }),
    ]);
    expect(r.totalRealized).toBeCloseTo(0, 6);
    expect(r.ending.USD.qty).toBeCloseTo(100, 6);
  });

  it('крос EUR→USD: віддали USD (реалізує), придбали EUR за тією ж гривнею', () => {
    // Каса має 200 USD @44. Клієнт дає EUR, отримує 100 USD; totalUah = 100*44.85 = 4485.
    const opening: PositionMap = { USD: { qty: 200, avgCost: 44.0 }, EUR: { qty: 0, avgCost: 0 } };
    const r = wacRealized(opening, [
      op({ type: 'EXCHANGE', currency: 'USD', amount: 100, totalUah: 4485, payCurrency: 'EUR', payAmount: 105 }),
    ]);
    // USD-плече: продали 100 @44.85 проти собівартості 44 → +85.
    expect(r.byCurrency.USD).toBeCloseTo(85, 6);
    // EUR придбали 105 за 4485 грн → собівартість 42.71..., прибутку немає.
    expect(r.ending.EUR.qty).toBeCloseTo(105, 6);
    expect(r.ending.EUR.avgCost).toBeCloseTo(4485 / 105, 6);
    expect(r.ending.USD.qty).toBeCloseTo(100, 6);
  });

  it('applyTrade: переворот позиції (продали більше, ніж мали)', () => {
    const pos: WacPosition = { qty: 100, avgCost: 44.0 };
    const realized = applyTrade(pos, -150, 45.0); // продали 150 @45, мали лише 100
    expect(realized).toBeCloseTo(100 * (45 - 44), 6); // закрили 100 → +100
    expect(pos.qty).toBeCloseTo(-50, 6);              // залишок -50 (коротка)
    expect(pos.avgCost).toBeCloseTo(45.0, 6);         // за ціною продажу
  });
});
