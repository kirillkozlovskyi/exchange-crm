import { ShiftsService } from './shifts.service';
import { ProfitService } from '../profit/profit.service';
import { tillUsdValue } from '../common/wac-profit.util';

/**
 * ПОВНА симуляція тижня роботи обмінника ($-числовник) — усі типи документів:
 *   купівля, продаж, крос-обмін, сторно, підкріплення, інкасація, передача між
 *   касами, своп, USDT-операція, нестача касира.
 *
 * Головна перевірка — ІНВАРІАНТ ГРОШЕЙ У ДОЛАРАХ:
 *   Σ прибутків змін (у $) == наскільки каса реально стала багатшою в доларах
 *   (за принципом власника: гривня ÷ сер. курс, валюта × $-крос), якщо вилучити
 *   все, що не є торгівлею (підкріплення/інкасації, передачі) і нестачі касира.
 * Якщо модель прибутку десь «вигадує» чи «губить» гроші — цей тест впаде.
 */

const S = 44.6; // курс продажу USD — незмінний увесь тиждень
const RATES = [
  { currency: 'USD', buy: 44.0, sell: S },
  { currency: 'EUR', buy: 51.0, sell: 51.8 },
];
const EUR_X = 51.0 / S; // $-крос євро (fallback від buy/S) ≈ 1.1435

function makeWorld() {
  const basis = new Map<string, number>();
  let shift: any = null;
  let transfers: any[] = [];
  const rateRows = RATES.map((r) => ({ ...r, createdAt: new Date(0) }));

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
    transfer: {
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(where?.status === 'PENDING' ? [] : transfers),
      ),
    },
    deskCostBasis: {
      findMany: jest.fn(() => Promise.resolve([...basis].map(([currency, avgCost]) => ({ currency, avgCost })))),
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

  let seq = 0;
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 6, 6) + ++tick * 60_000);

  return {
    service,
    stamp,
    basisOf: (c: string) => basis.get(c),
    setTransfers: (rows: any[]) => { transfers = rows; },
    // Документи зміни
    buy: (currency: string, amount: number, rate: number) => ({
      id: ++seq, type: 'BUY', currency, amount, totalUah: amount * rate,
      payCurrency: null, payAmount: null, cancelled: false, createdAt: stamp(),
    }),
    sell: (currency: string, amount: number, rate: number, cancelled = false) => ({
      id: ++seq, type: 'SELL', currency, amount, totalUah: amount * rate,
      payCurrency: null, payAmount: null, cancelled, createdAt: stamp(),
    }),
    // Крос: клієнт дає payAmount payCurrency, отримує amount currency (через гривню).
    cross: (currency: string, amount: number, payCurrency: string, payAmount: number, totalUah: number) => ({
      id: ++seq, type: 'EXCHANGE', currency, amount, totalUah,
      payCurrency, payAmount, cancelled: false, createdAt: stamp(),
    }),
    move: (direction: 'IN' | 'OUT', currency: string, amount: number) => ({
      id: ++seq, direction, currency, amount, createdAt: stamp(),
    }),
    usdt: (side: 'BUY' | 'SELL', usdtAmount: number, settleCurrency: string, settleAmount: number, profitUah: number, profitUsd: number) => ({
      id: ++seq, side, usdtAmount, settleCurrency, settleAmount, profitUah, profitUsd, cancelled: false, createdAt: stamp(),
    }),
    openShift: (startBalance: Record<string, number>, docs: {
      operations?: any[]; cashMovements?: any[]; usdtOperations?: any[];
    }) => {
      shift = {
        id: ++seq, status: 'OPEN', cashDeskId: 7, openedAt: stamp(),
        startBalance,
        operations: docs.operations ?? [],
        cashMovements: docs.cashMovements ?? [],
        usdtOperations: docs.usdtOperations ?? [],
        cashDesk: { exchangePointId: 1 },
      };
      return shift;
    },
    close: (endBalance?: Record<string, number>) => service.closeShift(shift.id, endBalance),
    current: () => shift,
  };
}

describe('ПОВНА симуляція тижня обмінника (усі типи операцій, $-числовник)', () => {
  const w = makeWorld();

  // Стан для наскрізної перевірки грошей
  let profitUsdSum = 0;   // Σ торгового прибутку змін ($)
  let shortageUsd = 0;    // Σ нестач/надлишків касира у $ (не торгівля)

  const startBal = { UAH: 500_000, USD: 5_000, EUR: 2_000 };

  it('ПН: відкуп реалізує проти бази гривні, продаж USD і сторно — нулі', async () => {
    const ops = [
      w.buy('USD', 2000, 44.0),       // відкуп 2000 @44.00 проти бази 44.60 (fallback S)
      w.sell('USD', 3000, 44.6),      // продаж — 0, формує базу
      w.sell('USD', 500, 44.6, true), // СТОРНО — не рахується
    ];
    w.openShift(startBal, { operations: ops });
    const res: any = await w.close();

    // Відкуп: 2000 − 88000/44.6 ≈ 26.91 $ (у ₴ ×44.6 = рівно 1200).
    expect(Number(res.profitUsd)).toBeCloseTo(2000 - 88_000 / S, 3);
    expect(Number(res.profit)).toBeCloseTo(1200, 1);
    // Сторнована операція має profit = 0; продаж теж 0.
    expect(Number((ops[1] as any).profit)).toBeCloseTo(0, 6);
    expect(Number((ops[2] as any).profit)).toBe(0);
    expect(res.calcBalance.USD).toBeCloseTo(4000, 2); // 5000 + 2000 − 3000
    // Сер. курс гривні лишився 44.6 (усі рухи за цим курсом); USD без бази.
    expect(w.basisOf('UAH')).toBeCloseTo(S, 6);
    expect(w.basisOf('USD')).toBeUndefined();
    profitUsdSum += Number(res.profitUsd);
  });

  it('ВТ: підкріплення USD і продаж 5000 — прибутку НЕМАЄ (продаж лише формує базу)', async () => {
    const prev = w.current().endBalance ?? w.current().calcBalance;
    const moves = [w.move('IN', 'USD', 3000)];  // підкріпили 3000 USD (числовник — без флоу)
    const ops = [w.sell('USD', 5000, 44.6)];    // продали 5000 → 0 (стара WAC дала б 3000 ₴)
    w.openShift(prev, { operations: ops, cashMovements: moves });
    const res: any = await w.close();

    expect(Number(res.profit)).toBeCloseTo(0, 2);
    expect(res.calcBalance.USD).toBeCloseTo(2000, 2); // 4000 + 3000 − 5000
    expect(w.basisOf('UAH')).toBeCloseTo(S, 6);       // виручка за 44.6 не змінила базу
    profitUsdSum += Number(res.profitUsd);
  });

  it('СР: крос EUR→USD — віддати числовник не прибуток; євро успадковує крос; інкасація — не торгівля', async () => {
    const prev = w.current().calcBalance;
    // Клієнт дає 1000 EUR (по buy 51 → 51 000 грн), отримує 1143.5 USD (по sell 44.6).
    const ops = [w.cross('USD', 1143.5, 'EUR', 1000, 51_000)];
    const moves = [w.move('OUT', 'UAH', 100_000)]; // інкасація гривні
    w.openShift(prev, { operations: ops, cashMovements: moves });
    const res: any = await w.close();

    // Каса віддала USD (числовник — без реалізації) і придбала EUR за прямим
    // кросом 1143.5/1000 ≈ 1.1435 $/€ — прибуток стане при ПРОДАЖУ євро.
    expect(Number(res.profit)).toBeCloseTo(0, 1);
    expect(res.calcBalance.USD).toBeCloseTo(2000 - 1143.5, 1);
    expect(res.calcBalance.EUR).toBeCloseTo(3000, 2);
    expect(w.basisOf('EUR')).toBeCloseTo(1.1435, 3);
    expect(res.netCashMovements).toEqual({ UAH: -100_000 });
    profitUsdSum += Number(res.profitUsd);
  });

  it('ЧТ: передача, відкуп, продаж євро проти кросу, USDT-маржа', async () => {
    const prev = w.current().calcBalance;
    // Відправили 1000 USD на касу 9 (підтверджено).
    w.setTransfers([
      { currency: 'USD', amount: 1000, fromDeskId: 7, toDeskId: 9, counterCurrency: null, counterAmount: null, confirmedAt: w.stamp() },
    ]);
    const ops = [
      w.buy('USD', 2000, 44.0),  // відкуп → прибуток проти бази 44.6
      w.sell('EUR', 500, 51.8),  // проти кросу ≈ 51/44.6
    ];
    // USDT: продали 300 USDT за 13 500 UAH; маржа 150 ₴ ≈ 3.36 $.
    const usdtOps = [w.usdt('SELL', 300, 'UAH', 13_500, 150, 150 / S)];
    w.openShift(prev, { operations: ops, usdtOperations: usdtOps });
    const res: any = await w.close();

    // Відкуп: 2000 − 88000/44.6 ≈ 26.91 $ (1200 ₴); EUR: 500 × (51.8/44.6 − ~1.1435) ≈ 8.97 $ (~400 ₴).
    const buyback = 2000 - 88_000 / S;
    expect(Number(res.profit)).toBeCloseTo(1200 + 400 + 150, 0);
    expect(Number(res.profitUsd)).toBeCloseTo(buyback + 400 / S + 150 / S, 1);
    expect(res.profitByCurrency.USDT).toBeCloseTo(150, 2);
    expect(res.profitByCurrencyUsd.USDT).toBeCloseTo(150 / S, 4);
    // Передача зменшила залишок, але не прибуток.
    expect(res.netTransfers).toEqual({ USD: -1000 });
    expect(res.calcBalance.USD).toBeCloseTo(856.5 + 2000 - 1000, 1);
    profitUsdSum += Number(res.profitUsd);
  });

  it('ПТ: своп USD↔EUR — рух валюти без прибутку; продаж USD — 0', async () => {
    const prev = w.current().calcBalance;
    // Отримали 2000 USD, віддали 1500 EUR (зустрічне плече свопу).
    w.setTransfers([
      { currency: 'USD', amount: 2000, fromDeskId: 9, toDeskId: 7, counterCurrency: 'EUR', counterAmount: 1500, confirmedAt: w.stamp() },
    ]);
    const ops = [w.sell('USD', 1000, 44.6)];
    w.openShift(prev, { operations: ops, usdtOperations: [] });
    const res: any = await w.close();

    // Своп не дає прибутку; продаж USD — 0 (стара WAC дала б +600 ₴).
    expect(Number(res.profit)).toBeCloseTo(0, 1);
    expect(res.netTransfers).toEqual({ USD: 2000, EUR: -1500 });
    profitUsdSum += Number(res.profitUsd);
    w.setTransfers([]);
  });

  it('СБ: купівля+продаж євро в одній зміні; нестача касира — окремо від торгового', async () => {
    const prev = w.current().calcBalance;
    const ops = [w.buy('EUR', 1000, 51.0), w.sell('EUR', 800, 51.8)];
    w.openShift(prev, { operations: ops });
    const shift = w.current();

    // Порахуємо очікуваний залишок і «загубимо» 100 USD.
    const expectedUsd = Number(prev.USD ?? 0);
    const res: any = await w.close({
      ...prev,
      UAH: Number(prev.UAH) - 1000 * 51.0 + 800 * 51.8,
      EUR: Number(prev.EUR) + 1000 - 800,
      USD: expectedUsd - 100, // нестача 100 USD
    });

    // Торговий: EUR 800 × (51.8 − 51)/44.6 ≈ 14.35 $ (≈640 ₴) — крос і в старту, і в купівлі ≈ 51/44.6.
    expect(Number(res.profit)).toBeCloseTo(640, 0);
    // Фактичний = торговий − 100 × 44.60 (курс ПРОДАЖУ).
    expect(Number(res.factualProfit)).toBeCloseTo(Number(res.profit) - 100 * S, 1);
    expect(Number(res.factualProfitUsd)).toBeCloseTo(Number(res.profitUsd) - 100, 2);
    profitUsdSum += Number(res.profitUsd);
    shortageUsd += -100;
    expect(shift.status).toBe('CLOSED');
  });

  it('НД: розпродаж — USD дає 0 (числовник), євро реалізує проти кросу', async () => {
    const prev = w.current().endBalance;
    const usd = Number(prev.USD ?? 0);
    const eur = Number(prev.EUR ?? 0);
    const ops = [w.sell('USD', usd, 44.6), w.sell('EUR', eur, 51.8)];
    w.openShift(prev, { operations: ops });
    const res: any = await w.close();

    // Лише євро: eur × (51.8 − 51)/44.6 у $; USD-продаж — 0.
    expect(Number(res.profitUsd)).toBeCloseTo((eur * (51.8 - 51.0)) / S, 0);
    expect(res.calcBalance.USD).toBeCloseTo(0, 6);
    expect(res.calcBalance.EUR).toBeCloseTo(0, 6);
    profitUsdSum += Number(res.profitUsd);
  });

  it('ІНВАРІАНТ: Σ прибутків ($) == реальне збагачення каси в доларах', () => {
    const end = w.current().calcBalance as Record<string, number>;

    // Оцінка каси за принципом власника: гривня ÷ 44.6, євро × крос, USD як є.
    const val = (b: Record<string, number>) =>
      tillUsdValue(b, { UAH: S, EUR: EUR_X }).total;

    // Скільки грошей реально прийшло/пішло НЕ через торгівлю (у $):
    //  • підкріплення 3000 USD (Вт); інкасація 100 000 UAH (Ср);
    //  • передача −1000 USD (Чт); своп +2000 USD / −1500 EUR (Пт);
    //  • USDT: у касу зайшло 13 500 UAH готівки, з них ~3.36 $ — маржа (торгівля),
    //    решта — обмін на USDT з гаманця (не торгівля);
    //  • нестача касира 100 USD (Сб).
    const nonTrade =
      3000 - 100_000 / S - 1000 + 2000 - 1500 * EUR_X + (13_500 / S - 150 / S) - 100;

    const enrichment = val(end) - val(startBal) - nonTrade;

    // Збагачення від ТОРГІВЛІ має дорівнювати сумі прибутків змін у $.
    expect(enrichment).toBeCloseTo(profitUsdSum, 0);
    expect(shortageUsd).toBeCloseTo(-100, 6);
  });
});
