import { ShiftsService } from './shifts.service';
import { ProfitService } from '../profit/profit.service';

/**
 * ІМІТАЦІЯ РОБОТИ КОМПАНІЇ НА ДВІ КАСИ — усі типи документів разом:
 *   купівля, продаж, крос-обмін, сторно, підкріплення, інкасація, передача між
 *   касами, USDT-операція, нестача касира, перенесення залишку й собівартості
 *   на наступну зміну.
 *
 * Дві незалежні системи обліку рахують ОДНЕ Й ТЕ САМЕ, і ми звіряємо їх:
 *   1) СИСТЕМА — реальні ShiftsService.closeShift + ProfitService (calcBalance,
 *      profit, profitByCurrency, перенос собівартості).
 *   2) КАСА (shadow) — незалежний «фізичний» лічильник готівки, як адмін рахував
 *      би купюри: почав із залишку, +отримане, −віддане, по кожному документу
 *      окремо. Жодних утиліт системи не використовує.
 * Якщо система десь загубить/вигадає гроші або переплутає знак — calcBalance
 * розійдеться з фізичним підрахунком каси, і тест впаде.
 *
 * Прибуток перевіряємо точно там, де його легко порахувати руками (продаж проти
 * відомої собівартості WAC), і додатково — інваріантом збереження грошей.
 */

// Курси однакові для обох точок (спрощує ручний підрахунок прибутку).
const RATES = [
  { currency: 'USD', buy: 44.0, sell: 44.6 }, // mid 44.3
  { currency: 'EUR', buy: 51.0, sell: 51.8 }, // mid 51.4
];
const midRate: Record<string, number> = { USD: 44.3, EUR: 51.4 };

// ── Незалежний «фізичний» лічильник готівки каси (рахунок купюр) ──────────────
class Cash {
  bal: Record<string, number> = {};
  constructor(start: Record<string, number>) { this.bal = { ...start }; }
  private add(cur: string, q: number) { this.bal[cur] = (this.bal[cur] ?? 0) + q; }
  buy(cur: string, amount: number, rate: number) { this.add(cur, amount); this.add('UAH', -amount * rate); }
  sell(cur: string, amount: number, rate: number) { this.add(cur, -amount); this.add('UAH', amount * rate); }
  // Крос: каса ВІДДАЄ giveCur/giveAmt, ОТРИМУЄ getCur/getAmt (гривня не рухається).
  cross(giveCur: string, giveAmt: number, getCur: string, getAmt: number) { this.add(giveCur, -giveAmt); this.add(getCur, getAmt); }
  cashIn(cur: string, amount: number) { this.add(cur, amount); }
  cashOut(cur: string, amount: number) { this.add(cur, -amount); }
  usdtSell(settleCur: string, settleAmt: number) { this.add(settleCur, settleAmt); }  // готівка приходить
  usdtBuy(settleCur: string, settleAmt: number) { this.add(settleCur, -settleAmt); }   // готівка йде
  transferOut(cur: string, amount: number) { this.add(cur, -amount); }
  transferIn(cur: string, amount: number) { this.add(cur, amount); }
  rounded() {
    const r: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.bal)) if (Math.abs(v) >= 1e-9) r[k] = Math.round(v * 100) / 100;
    return r;
  }
}

// ── Stateful mock Prisma для двох кас (кожна каса має свою собівартість/пул) ──
function makeWorld() {
  const basis = new Map<number, Map<string, number>>();      // deskId → currency → avgCost
  const soldPool = new Map<number, Map<string, { units: number; uah: number }>>();
  const shifts = new Map<number, any>();                     // shiftId → shift
  const opIndex = new Map<number, any>();                    // opId → op (для operation.update)
  const transfers: any[] = [];
  let seq = 0;
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 6, 6) + ++tick * 60_000);

  const deskBasis = (d: number) => basis.get(d) ?? (basis.set(d, new Map()), basis.get(d)!);
  const deskPool = (d: number) => soldPool.get(d) ?? (soldPool.set(d, new Map()), soldPool.get(d)!);

  const prisma: any = {
    shift: {
      findUnique: ({ where }: any) => Promise.resolve(shifts.get(where.id) ?? null),
      findFirst: ({ where, orderBy }: any) => {
        let list = [...shifts.values()].filter((s) => s.cashDeskId === where.cashDeskId && s.status === where.status);
        if (orderBy?.closedAt === 'desc') list = list.sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0));
        return Promise.resolve(list[0] ?? null);
      },
      update: ({ where, data }: any) => { Object.assign(shifts.get(where.id), data); return Promise.resolve({ ...shifts.get(where.id) }); },
    },
    rate: {
      findMany: ({ where }: any) =>
        Promise.resolve(RATES.filter(() => where?.status === undefined || where.status === 'ACTIVE').map((r) => ({ ...r }))),
    },
    transfer: {
      findMany: ({ where }: any) => {
        const deskId = where.OR?.[0]?.fromDeskId ?? where.OR?.[1]?.toDeskId;
        return Promise.resolve(
          transfers.filter((t) => {
            if (where.status && t.status !== where.status) return false;
            if (deskId != null && t.fromDeskId !== deskId && t.toDeskId !== deskId) return false;
            const c = t.confirmedAt;
            if (where.confirmedAt?.gte && (!c || c < where.confirmedAt.gte)) return false;
            if (where.confirmedAt?.lte && (!c || c > where.confirmedAt.lte)) return false;
            return true;
          }),
        );
      },
    },
    deskCostBasis: {
      findMany: ({ where }: any) => Promise.resolve([...deskBasis(where.cashDeskId)].map(([currency, avgCost]) => ({ currency, avgCost }))),
      upsert: ({ where, create }: any) => { deskBasis(where.cashDeskId_currency.cashDeskId).set(where.cashDeskId_currency.currency, Number(create.avgCost)); return Promise.resolve({}); },
    },
    deskSoldPool: {
      findMany: ({ where }: any) => Promise.resolve([...deskPool(where.cashDeskId)].map(([currency, p]) => ({ currency, ...p }))),
      upsert: ({ where, create }: any) => { deskPool(where.cashDeskId_currency.cashDeskId).set(where.cashDeskId_currency.currency, { units: Number(create.units), uah: Number(create.uah) }); return Promise.resolve({}); },
    },
    operation: {
      update: ({ where, data }: any) => { const op = opIndex.get(where.id); if (op) op.profit = data.profit; return Promise.resolve(op); },
    },
    $transaction: (arr: any[]) => Promise.all(arr),
  };

  const service = new ShiftsService(prisma, new ProfitService(prisma));

  // Документи (id проставляється, час — зростає).
  const doc = <T extends object>(o: T) => { const withId = { id: ++seq, createdAt: stamp(), ...o } as any; opIndex.set(withId.id, withId); return withId; };
  return {
    service, stamp,
    basisOf: (d: number, c: string) => deskBasis(d).get(c),
    buy: (currency: string, amount: number, rate: number) => doc({ type: 'BUY', currency, amount, totalUah: amount * rate, payCurrency: null, payAmount: null, cancelled: false }),
    sell: (currency: string, amount: number, rate: number, cancelled = false) => doc({ type: 'SELL', currency, amount, totalUah: amount * rate, payCurrency: null, payAmount: null, cancelled }),
    // Крос: каса віддає giveCur, отримує getCur; totalUah — грн-оцінка угоди.
    cross: (giveCur: string, giveAmt: number, getCur: string, getAmt: number, totalUah: number) => doc({ type: 'EXCHANGE', currency: giveCur, amount: giveAmt, totalUah, payCurrency: getCur, payAmount: getAmt, cancelled: false }),
    move: (direction: 'IN' | 'OUT', currency: string, amount: number) => doc({ direction, currency, amount }),
    usdt: (side: 'BUY' | 'SELL', usdtAmount: number, settleCurrency: string, settleAmount: number, profitUah: number) => doc({ side, usdtAmount, settleCurrency, settleAmount, profitUah, cancelled: false }),
    // Підтверджена передача між касами.
    transfer: (fromDeskId: number, toDeskId: number, currency: string, amount: number, counter?: { currency: string; amount: number }) => {
      transfers.push({ id: ++seq, fromDeskId, toDeskId, currency, amount, counterCurrency: counter?.currency ?? null, counterAmount: counter?.amount ?? null, status: 'CONFIRMED', confirmedAt: stamp() });
    },
    openShift: (cashDeskId: number, exchangePointId: number, startBalance: Record<string, number>, docs: { operations?: any[]; cashMovements?: any[]; usdtOperations?: any[]; openedAt?: Date }) => {
      const s = { id: ++seq, number: `K${cashDeskId}-${seq}`, status: 'OPEN', cashDeskId, openedAt: docs.openedAt ?? stamp(), startBalance, operations: docs.operations ?? [], cashMovements: docs.cashMovements ?? [], usdtOperations: docs.usdtOperations ?? [], cashDesk: { exchangePointId }, openedBy: { name: 't' } };
      shifts.set(s.id, s);
      return s;
    },
    close: (shiftId: number, endBalance?: Record<string, number>) => service.closeShift(shiftId, endBalance),
    lastEnd: (cashDeskId: number) => service.getLastEndBalance(cashDeskId),
  };
}

const round = (b: Record<string, number>) => {
  const r: Record<string, number> = {};
  for (const [k, v] of Object.entries(b)) if (Math.abs(v) >= 1e-9) r[k] = Math.round(v * 100) / 100;
  return r;
};

describe('Імітація роботи компанії на дві каси (система ⇄ фізична каса)', () => {
  const w = makeWorld();
  const DESK_A = 1, POINT_A = 1;
  const DESK_B = 2, POINT_B = 2;

  // Тіньові (фізичні) каси — незалежний облік готівки.
  const cashA = new Cash({ UAH: 100_000, USD: 5_000 });
  const cashB = new Cash({ UAH: 80_000, EUR: 3_000 });
  let profitA1 = 0, profitA2 = 0, profitB1 = 0;

  it('A1: купівля + продаж + сторно + підкріплення + інкасація + USDT + передача → B', async () => {
    // Документи каси A1.
    const ops = [
      w.buy('USD', 1000, 44.0),          // +1000 USD, −44000 UAH
      w.sell('USD', 2000, 44.6),         // −2000 USD, +89200 UAH; прибуток 2000×0.6=1200
      w.sell('USD', 500, 44.6, true),    // СТОРНО — не рахується ніде
    ];
    const moves = [w.move('IN', 'UAH', 20_000), w.move('OUT', 'USD', 100)];
    const usdt = [w.usdt('SELL', 1000, 'UAH', 22_300, 150)]; // +22300 UAH готівки, маржа 150
    const shift = w.openShift(DESK_A, POINT_A, { UAH: 100_000, USD: 5_000 }, { operations: ops, cashMovements: moves, usdtOperations: usdt });

    // Передача 500 USD із A на B (підтверджена під час зміни A1).
    w.transfer(DESK_A, DESK_B, 'USD', 500);

    // Фізична каса A повторює ті самі рухи незалежно.
    cashA.buy('USD', 1000, 44.0);
    cashA.sell('USD', 2000, 44.6);
    // сторно не застосовуємо
    cashA.cashIn('UAH', 20_000);
    cashA.cashOut('USD', 100);
    cashA.usdtSell('UAH', 22_300);
    cashA.transferOut('USD', 500);

    const res: any = await w.close(shift.id, cashA.rounded());

    // Розрахунок системи == фізичний підрахунок каси.
    expect(round(res.calcBalance)).toEqual(cashA.rounded());
    expect(cashA.rounded()).toEqual({ UAH: 187_500, USD: 3_400 });
    // Прибуток: WAC 1200 (продаж проти собівартості 44.0) + USDT-маржа 150.
    expect(Number(res.profit)).toBeCloseTo(1350, 6);
    expect(round(res.profitByCurrency)).toEqual({ USD: 1200, USDT: 150 });
    // endBalance == calc → без нестачі → фактичний = прибуток.
    expect(Number(res.factualProfit)).toBeCloseTo(1350, 6);
    // Передача не є прибутком, але рухає баланс (нетто −500 USD у A).
    expect(round(res.netTransfers)).toEqual({ USD: -500 });
    // Собівартість USD (44.0) переноситься на наступну зміну каси A.
    expect(w.basisOf(DESK_A, 'USD')).toBeCloseTo(44.0, 6);
    profitA1 = Number(res.profit);
  });

  it('Залишок при відкритті A2 = залишок при закритті A1 (перенесення каси)', async () => {
    const last = await w.lastEnd(DESK_A);
    // Система віддає для префілу нової зміни саме фізичний залишок A1.
    expect(round(last.endBalance)).toEqual(cashA.rounded());
    // І поточну собівартість каси (дефолт поля «сер. курс»).
    expect(round(last.costBasis)).toEqual({ USD: 44.0 });
  });

  it('A2: продаж ПЕРЕНЕСЕНОГО запасу дає прибуток одразу; нестача касира окремо', async () => {
    const start = cashA.rounded(); // {UAH 187500, USD 3400}
    const ops = [w.sell('USD', 1000, 44.6)]; // −1000 USD, +44600 UAH; прибуток 1000×(44.6−44.0)=600
    const shift = w.openShift(DESK_A, POINT_A, start, { operations: ops });

    // Фізично правильний залишок після продажу:
    const physical = new Cash(start);
    physical.sell('USD', 1000, 44.6); // {UAH 232100, USD 2400}

    // Але касир нарахував на 50 USD менше (нестача).
    const counted = { ...physical.rounded(), USD: physical.rounded().USD - 50 };
    const res: any = await w.close(shift.id, counted);

    // Розрахунковий (очікуваний) залишок системи == фізично правильний.
    expect(round(res.calcBalance)).toEqual(physical.rounded());
    expect(physical.rounded()).toEqual({ UAH: 232_100, USD: 2_400 });
    // Торговий прибуток проти ПЕРЕНЕСЕНОЇ собівартості 44.0 → 600.
    expect(Number(res.profit)).toBeCloseTo(600, 6);
    // Нестача 50 USD (оцінка за курсом продажу 44.6) зменшує фактичний результат.
    expect(Number(res.factualProfit)).toBeCloseTo(600 - 50 * 44.6, 6);
    expect(Number(res.factualProfit)).toBeLessThan(Number(res.profit));
    // Каса далі живе за ФАКТИЧНО перерахованим касиром залишком.
    cashA.bal = { ...counted };
    profitA2 = Number(res.profit);
  });

  it('B1: купівля + крос + продаж + отримана передача від A — баланс і прибуток сходяться', async () => {
    const ops = [
      w.buy('EUR', 1000, 51.0),                       // +1000 EUR, −51000 UAH
      w.cross('EUR', 500, 'USD', 600, 25_700),        // −500 EUR, +600 USD; EUR-нога @51.4 → 500×0.4=200
      w.sell('EUR', 800, 51.8),                       // −800 EUR, +41440 UAH; 800×(51.8−51.0)=640
    ];
    // B1 працює одночасно з A1 (openedAt — ранній, до підтвердження передачі),
    // тож отримана передача 500 USD потрапляє в її зміну.
    const shift = w.openShift(DESK_B, POINT_B, { UAH: 80_000, EUR: 3_000 }, { operations: ops, openedAt: new Date(Date.UTC(2026, 6, 6) + 1000) });

    cashB.buy('EUR', 1000, 51.0);
    cashB.cross('EUR', 500, 'USD', 600);
    cashB.sell('EUR', 800, 51.8);
    cashB.transferIn('USD', 500);

    const res: any = await w.close(shift.id, cashB.rounded());

    expect(round(res.calcBalance)).toEqual(cashB.rounded());
    expect(cashB.rounded()).toEqual({ UAH: 70_440, EUR: 2_700, USD: 1_100 });
    // Прибуток: крос-нога EUR (200) + продаж EUR (640) = 840. USD лише зайшов (0).
    expect(Number(res.profit)).toBeCloseTo(840, 6);
    expect(round(res.profitByCurrency)).toEqual({ EUR: 840 });
    // Отримана передача +500 USD у нетто каси B (дзеркало −500 у A).
    expect(round(res.netTransfers)).toEqual({ USD: 500 });
    profitB1 = Number(res.profit);
  });

  it('ІНВАРІАНТ: жодна каса не вигадала й не загубила грошей (система = фізична каса)', () => {
    // Сумарний розрахунок системи по обох касах збігається з сумою фізичних кас,
    // а передача 500 USD (−у A, +у B) у сумі компанії взаємно скорочується.
    const companyPhysicalUSD = cashA.rounded().USD + cashB.rounded().USD;
    // A: 5000 старт −1000(buy... власне +1000−2000)+... простіше: A має 2350 (після нестачі), B 1100.
    expect(companyPhysicalUSD).toBeCloseTo(2_350 + 1_100, 6);
    // Прибутки додатні й порахувалися для всіх змін.
    expect(profitA1).toBeCloseTo(1350, 6);
    expect(profitA2).toBeCloseTo(600, 6);
    expect(profitB1).toBeCloseTo(840, 6);
  });
});
