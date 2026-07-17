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
 * Прибуток перевіряємо точно там, де його легко порахувати руками ($-числовник:
 * відкуп проти бази гривні, продаж валюти проти $-кросу), і додатково —
 * інваріантом збереження грошей.
 */

// Курси однакові для обох точок (спрощує ручний підрахунок прибутку).
const S = 44.6; // курс продажу USD (база гривні за замовчуванням)
const RATES = [
  { currency: 'USD', buy: 44.0, sell: S },
  { currency: 'EUR', buy: 51.0, sell: 51.8 },
];
const EUR_X = 51.0 / S; // $-крос євро (fallback buy/S) ≈ 1.143498

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

// ── Stateful mock Prisma для двох кас (кожна каса має свою собівартість) ──
function makeWorld() {
  const basis = new Map<number, Map<string, number>>();      // deskId → currency → avgCost
  const shifts = new Map<number, any>();                     // shiftId → shift
  const opIndex = new Map<number, any>();                    // opId → op (для operation.update)
  const transfers: any[] = [];
  let seq = 0;
  let tick = 0;
  const stamp = () => new Date(Date.UTC(2026, 6, 6) + ++tick * 60_000);

  const deskBasis = (d: number) => basis.get(d) ?? (basis.set(d, new Map()), basis.get(d)!);
  const rateRows = RATES.map((r) => ({ ...r, createdAt: new Date(0) }));

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
      // where-свідомий мок: getUsdTimeline фільтрує по currency='USD'.
      findMany: ({ where }: any) => {
        let rows = rateRows;
        if (where?.currency) rows = rows.filter((r) => r.currency === where.currency);
        return Promise.resolve(rows.map((r) => ({ ...r })));
      },
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
    operation: {
      update: ({ where, data }: any) => { const op = opIndex.get(where.id); if (op) { op.profit = data.profit; op.profitUsd = data.profitUsd; } return Promise.resolve(op); },
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
    usdt: (side: 'BUY' | 'SELL', usdtAmount: number, settleCurrency: string, settleAmount: number, profitUah: number, profitUsd: number) => doc({ side, usdtAmount, settleCurrency, settleAmount, profitUah, profitUsd, cancelled: false }),
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

  it('A1: відкуп + продаж + сторно + підкріплення + інкасація + USDT + передача → B', async () => {
    // Документи каси A1.
    const ops = [
      w.buy('USD', 1000, 44.0),          // +1000 USD, −44000 UAH; відкуп проти бази 44.6 → 600 ₴
      w.sell('USD', 2000, 44.6),         // −2000 USD, +89200 UAH; продаж → 0 (формує базу)
      w.sell('USD', 500, 44.6, true),    // СТОРНО — не рахується ніде
    ];
    const moves = [w.move('IN', 'UAH', 20_000), w.move('OUT', 'USD', 100)];
    const usdt = [w.usdt('SELL', 1000, 'UAH', 22_300, 150, 150 / S)]; // +22300 UAH готівки, маржа 150 ₴
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
    // Прибуток: відкуп 1000 − 44000/44.6 ≈ 13.45 $ (600 ₴) + USDT-маржа 150 ₴.
    expect(Number(res.profit)).toBeCloseTo(750, 2);
    expect(Number(res.profitUsd)).toBeCloseTo((1000 - 44_000 / S) + 150 / S, 3);
    expect(round(res.profitByCurrency)).toEqual({ USD: 600, USDT: 150 });
    // endBalance == calc → без нестачі → фактичний = прибуток.
    expect(Number(res.factualProfit)).toBeCloseTo(750, 2);
    // Передача не є прибутком, але рухає баланс (нетто −500 USD у A).
    expect(round(res.netTransfers)).toEqual({ USD: -500 });
    // Сер. курс гривні (44.6) переноситься на наступну зміну; USD без бази.
    expect(w.basisOf(DESK_A, 'UAH')).toBeCloseTo(S, 6);
    expect(w.basisOf(DESK_A, 'USD')).toBeUndefined();
    profitA1 = Number(res.profit);
  });

  it('Залишок при відкритті A2 = залишок при закритті A1 (перенесення каси)', async () => {
    const last = await w.lastEnd(DESK_A);
    // Система віддає для префілу нової зміни саме фізичний залишок A1.
    expect(round(last.endBalance)).toEqual(cashA.rounded());
    // І поточну собівартість каси (дефолт поля «сер. курс») — тепер це база гривні.
    expect(round(last.costBasis)).toEqual({ UAH: S });
  });

  it('A2: продаж ПЕРЕНЕСЕНОГО запасу — 0 (заробіток буде на відкупі); нестача касира окремо', async () => {
    const start = cashA.rounded(); // {UAH 187500, USD 3400}
    const ops = [w.sell('USD', 1000, 44.6)]; // −1000 USD, +44600 UAH; продаж → 0
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
    // Продаж прибутку НЕ дає (стара WAC дала б 600 ₴) — гривня ще не відкуплена.
    expect(Number(res.profit)).toBeCloseTo(0, 2);
    // Нестача 50 USD (оцінка за курсом продажу 44.6) — увесь фактичний результат.
    expect(Number(res.factualProfit)).toBeCloseTo(-50 * 44.6, 2);
    expect(Number(res.factualProfitUsd)).toBeCloseTo(-50, 3);
    // Каса далі живе за ФАКТИЧНО перерахованим касиром залишком.
    cashA.bal = { ...counted };
    profitA2 = Number(res.profit);
  });

  it('B1: купівля + крос + продаж + отримана передача від A — баланс і прибуток сходяться', async () => {
    const ops = [
      w.buy('EUR', 1000, 51.0),                       // +1000 EUR, −51000 UAH; крос 51/44.6, без прибутку
      w.cross('EUR', 500, 'USD', 600, 25_700),        // −500 EUR, +600 USD; EUR реалізує @1.2 $/€
      w.sell('EUR', 800, 51.8),                       // −800 EUR, +41440 UAH; проти кросу 51/44.6
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
    // Прибуток: крос 500×(600/500 − 51/44.6) ≈ 28.25 $ (1260 ₴, отримали числовник —
    // реалізація одразу) + продаж 800×(51.8−51)/44.6 ≈ 14.35 $ (640 ₴) = 1900 ₴.
    expect(Number(res.profit)).toBeCloseTo(1900, 1);
    expect(Number(res.profitUsd)).toBeCloseTo(500 * (1.2 - EUR_X) + (800 * 0.8) / S, 3);
    expect(round(res.profitByCurrency)).toEqual({ EUR: 1900 });
    // Отримана передача +500 USD у нетто каси B (дзеркало −500 у A).
    expect(round(res.netTransfers)).toEqual({ USD: 500 });
    profitB1 = Number(res.profit);
  });

  it('ІНВАРІАНТ: жодна каса не вигадала й не загубила грошей (система = фізична каса)', () => {
    // Сумарний розрахунок системи по обох касах збігається з сумою фізичних кас,
    // а передача 500 USD (−у A, +у B) у сумі компанії взаємно скорочується.
    const companyPhysicalUSD = cashA.rounded().USD + cashB.rounded().USD;
    expect(companyPhysicalUSD).toBeCloseTo(2_350 + 1_100, 6);
    // Прибутки порахувалися для всіх змін ($-модель: відкуп/кроси, продаж USD — 0).
    expect(profitA1).toBeCloseTo(750, 2);
    expect(profitA2).toBeCloseTo(0, 2);
    expect(profitB1).toBeCloseTo(1900, 1);
  });
});
