import { ShiftsService } from './shifts.service';
import { ProfitService } from '../profit/profit.service';
import { valueOf } from '../common/profit.util';

/**
 * ПОВНА симуляція тижня роботи обмінника — усі типи документів разом:
 *   купівля, продаж, крос-обмін, сторно, підкріплення, інкасація, передача між
 *   касами, своп, USDT-операція, нестача касира.
 *
 * Головна перевірка — ІНВАРІАНТ ГРОШЕЙ:
 *   Σ прибутків змін == наскільки каса реально стала багатшою
 *   (гривня + валюта за собівартістю), якщо вилучити все, що не є торгівлею
 *   (підкріплення/інкасації, передачі) і нестачі касира.
 * Якщо модель прибутку десь «вигадує» чи «губить» гроші — цей тест впаде.
 */

const RATES = [
  { currency: 'USD', buy: 44.0, sell: 44.6 },
  { currency: 'EUR', buy: 51.0, sell: 51.8 },
];

function makeWorld() {
  const basis = new Map<string, number>();
  const soldPool = new Map<string, { units: number; uah: number }>();
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
    rate: { findMany: jest.fn(() => Promise.resolve(RATES.map((r) => ({ ...r })))) },
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
    deskSoldPool: {
      findMany: jest.fn(() => Promise.resolve([...soldPool].map(([currency, p]) => ({ currency, ...p })))),
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
    usdt: (side: 'BUY' | 'SELL', usdtAmount: number, settleCurrency: string, settleAmount: number, profitUah: number) => ({
      id: ++seq, side, usdtAmount, settleCurrency, settleAmount, profitUah, cancelled: false, createdAt: stamp(),
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

describe('ПОВНА симуляція тижня обмінника (усі типи операцій)', () => {
  const w = makeWorld();

  // Стан для наскрізної перевірки грошей
  let profitSum = 0;      // Σ торгового прибутку змін
  let shortageSum = 0;    // Σ нестач/надлишків касира (не торгівля)
  let usdtSum = 0;        // Σ маржі USDT (входить у profit, рахуємо окремо для звірки)

  const startBal = { UAH: 500_000, USD: 5_000, EUR: 2_000 };

  it('ПН: купівля + продаж + сторно — прибуток лише з реально проданого', async () => {
    const ops = [
      w.buy('USD', 2000, 44.0),      // купили 2000 @44.00
      w.sell('USD', 3000, 44.6),     // продали 3000 @44.60
      w.sell('USD', 500, 44.6, true), // СТОРНО — не рахується
    ];
    w.openShift(startBal, { operations: ops });
    const res: any = await w.close();

    // Старт 5000 USD @44 (собівартості ще немає → курс купівлі 44) + 2000 @44 → сер. 44.
    // Продаж 3000 × (44.60 − 44.00) = 1800.
    expect(Number(res.profit)).toBeCloseTo(1800, 2);
    // Сторнована операція має profit = 0.
    expect(Number((ops[2] as any).profit)).toBe(0);
    expect(res.calcBalance.USD).toBeCloseTo(4000, 2); // 5000 + 2000 − 3000
    profitSum += Number(res.profit);
  });

  it('ВТ: підкріплення валютою + продаж підкріпленого — валюта має собівартість, а не «нізвідки»', async () => {
    const prev = w.current().endBalance ?? w.current().calcBalance;
    const moves = [w.move('IN', 'USD', 3000)];         // підкріпили 3000 USD
    const ops = [w.sell('USD', 5000, 44.6)];           // продали 5000 (частина — підкріплені)
    w.openShift(prev, { operations: ops, cashMovements: moves });
    const res: any = await w.close();

    // Позиція: 4000 @44 (перенесено) + 3000 @44 (підкріплення за курсом купівлі) = 7000 @44.
    // Продаж 5000 × 0.60 = 3000. (Раніше це давало 0 — валюта «без собівартості».)
    expect(Number(res.profit)).toBeCloseTo(3000, 2);
    expect(res.calcBalance.USD).toBeCloseTo(2000, 2); // 4000 + 3000 − 5000
    profitSum += Number(res.profit);
  });

  it('СР: крос EUR→USD + інкасація — крос реалізує віддану валюту, інкасація прибутку не дає', async () => {
    const prev = w.current().calcBalance;
    // Клієнт дає 1000 EUR (по buy 51 → 51 000 грн), отримує 1143.5 USD (по sell 44.6).
    const ops = [w.cross('USD', 1143.5, 'EUR', 1000, 51_000)];
    const moves = [w.move('OUT', 'UAH', 100_000)]; // інкасація гривні
    w.openShift(prev, { operations: ops, cashMovements: moves });
    const res: any = await w.close();

    // Крос: каса ВІДДАЄ USD і ПРИЙМАЄ EUR (клієнт дає євро, отримує долари).
    // USD-плече: 1143.5 за ціною 51000/1143.5 проти собівартості 44 → ≈686.
    // EUR-плече: придбали 1000 за 51 000 → собівартість 51.00, прибутку немає.
    const crossPrice = 51_000 / 1143.5;
    expect(Number(res.profit)).toBeCloseTo(1143.5 * (crossPrice - 44.0), 1);
    expect(res.calcBalance.USD).toBeCloseTo(2000 - 1143.5, 1); // каса віддала долари
    expect(res.calcBalance.EUR).toBeCloseTo(3000, 2);          // 2000 + 1000 отримано
    profitSum += Number(res.profit);
  });

  it('ЧТ: передача 1000 USD іншій касі + USDT-операція — жодне не є спредом', async () => {
    const prev = w.current().calcBalance;
    // Відправили 1000 USD на касу 9 (підтверджено).
    w.setTransfers([
      { currency: 'USD', amount: 1000, fromDeskId: 7, toDeskId: 9, counterCurrency: null, counterAmount: null, confirmedAt: w.stamp() },
    ]);
    const ops = [
      w.buy('USD', 2000, 44.0),   // докупили долари (інакше передача завела б касу в мінус)
      w.sell('EUR', 500, 51.8),
    ];
    // USDT: продали 300 USDT за 13 500 UAH, маржа 150 грн.
    const usdtOps = [w.usdt('SELL', 300, 'UAH', 13_500, 150)];
    w.openShift(prev, { operations: ops, usdtOperations: usdtOps });
    const res: any = await w.close();

    // EUR-позиція: 2000 @51 (старт) + 1000 @51 (крос) → сер. 51.
    // Продаж 500 × (51.80 − 51.00) = 400. Купівля USD прибутку не дає.
    // + USDT-маржа 150 → 550.
    expect(Number(res.profit)).toBeCloseTo(400 + 150, 1);
    expect(res.profitByCurrency.USDT).toBeCloseTo(150, 2);
    // Передача зменшила залишок, але не прибуток.
    expect(res.netTransfers).toEqual({ USD: -1000 });
    expect(res.calcBalance.USD).toBeCloseTo(856.5 + 2000 - 1000, 1);
    profitSum += Number(res.profit);
    usdtSum += 150;
    w.setTransfers([]);
  });

  it('ПТ: своп із іншою касою (USD ↔ EUR) — рух валюти без прибутку', async () => {
    const prev = w.current().calcBalance;
    // Отримали 2000 USD, віддали 1500 EUR (зустрічне плече свопу).
    w.setTransfers([
      { currency: 'USD', amount: 2000, fromDeskId: 9, toDeskId: 7, counterCurrency: 'EUR', counterAmount: 1500, confirmedAt: w.stamp() },
    ]);
    const ops = [w.sell('USD', 1000, 44.6)];
    w.openShift(prev, { operations: ops, usdtOperations: [] });
    const res: any = await w.close();

    // Своп не дає прибутку; продаж 1000 USD проти собівартості 44 → +600.
    expect(Number(res.profit)).toBeCloseTo(600, 1);
    expect(res.netTransfers).toEqual({ USD: 2000, EUR: -1500 });
    profitSum += Number(res.profit);
    w.setTransfers([]);
  });

  it('СБ: нестача касира — торговий прибуток чистий, нестача окремо (за курсом продажу)', async () => {
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

    // Торговий: EUR 800 × (51.80 − 51.00) = 640 (собівартість 51 і в старту, і в купівлі).
    expect(Number(res.profit)).toBeCloseTo(640, 1);
    // Фактичний = торговий − 100 × 44.60 (курс ПРОДАЖУ) = 640 − 4460.
    expect(Number(res.factualProfit)).toBeCloseTo(640 - 100 * 44.6, 1);
    profitSum += Number(res.profit);
    shortageSum += Number(res.factualProfit) - Number(res.profit);
    expect(shift.status).toBe('CLOSED');
  });

  it('НД: розпродаж — прибуток проти перенесеної собівартості', async () => {
    const prev = w.current().endBalance;
    const usd = Number(prev.USD ?? 0);
    const eur = Number(prev.EUR ?? 0);
    const ops = [w.sell('USD', usd, 44.6), w.sell('EUR', eur, 51.8)];
    w.openShift(prev, { operations: ops });
    const res: any = await w.close();

    // Уся решта продана проти собівартості 44 (USD) і 51 (EUR).
    expect(Number(res.profit)).toBeCloseTo(usd * (44.6 - 44.0) + eur * (51.8 - 51.0), 1);
    expect(res.calcBalance.USD).toBeCloseTo(0, 6);
    expect(res.calcBalance.EUR).toBeCloseTo(0, 6);
    profitSum += Number(res.profit);
  });

  it('ІНВАРІАНТ: Σ прибутків == реальне збагачення каси (гроші не вигадані й не загублені)', () => {
    const end = w.current().calcBalance as Record<string, number>;

    // Скільки грошей реально прийшло/пішло НЕ через торгівлю:
    //  • підкріплення 3000 USD (Вт) — зайшло в касу ззовні;
    //  • інкасація 100 000 UAH (Ср) — пішла з каси;
    //  • передача −1000 USD (Чт), своп +2000 USD / −1500 EUR (Пт);
    //  • USDT: у касу зайшло 13 500 UAH готівки, з них 150 — маржа (торгівля),
    //    решта 13 350 — обмін на USDT з гаманця (не торгівля);
    //  • нестача касира 100 USD (Сб).
    const cost = { UAH: 1, USD: 44.0, EUR: 51.0 }; // собівартість позицій
    const nonTrade = {
      // інкасація 100 000 грн + готівка від USDT (13 500) без торгової маржі (150)
      UAH: -100_000 + (13_500 - 150),
      // підкріплення 3000 − передача 1000 + своп 2000 − нестача 100
      USD: 3000 - 1000 + 2000 - 100,
      EUR: -1500, // своп: віддали євро
    };

    const startValue = valueOf(startBal, cost);
    const endValue = valueOf(end, cost);
    const nonTradeValue = valueOf(nonTrade, cost);

    // Збагачення від ТОРГІВЛІ = приріст вартості каси − усе неторгове.
    const enrichment = endValue - startValue - nonTradeValue;

    // Воно має дорівнювати сумі торгових прибутків змін (нестача врахована в nonTrade).
    expect(enrichment).toBeCloseTo(profitSum, 0);
    expect(usdtSum).toBeCloseTo(150, 2);
    expect(shortageSum).toBeCloseTo(-100 * 44.6, 1);
  });
});
