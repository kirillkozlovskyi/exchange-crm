import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  wacRealizedTimeline,
  tillUsdValue,
  uahBasisToCost,
  costToUahBasis,
  NUMERAIRE,
  isNumeraire,
  WacItem,
  PositionMap,
  WacOperation,
} from '../common/wac-profit.util';
import { buildRateTimeline, RateTimeline } from '../common/rate-timeline.util';
import { CashMovementRow } from '../common/cash-movements.util';
import { usdtProfit, usdtProfitUsd, UsdtOp } from '../common/usdt.util';

/** USDT-операція з часом — для готівкових флоу зміни. */
type UsdtOpRow = UsdtOp & { createdAt?: Date | string };

/**
 * Прибуток за моделлю «каса в доларах» ($-числовник, WAC): позиція каси по
 * валюті (включно з ГРИВНЕЮ) відкривається від збереженої середньої
 * собівартості (DeskCostBasis, людський формат: UAH — ₴/$, інші — $-крос).
 * З 19.07.2026 DeskCostBasis задає ВЛАСНИК (форма відкриття/закриття зміни) і
 * програма її не переписує; WAC-еволюція діє лише всередині зміни (прибуток).
 * Кількість на відкриття зміни беремо з фактичного залишку (startBalance) —
 * щоб позиція не дрейфувала від передач/руху готівки. USD — числовник,
 * позиції не має.
 */
@Injectable()
export class ProfitService {
  private readonly logger = new Logger(ProfitService.name);
  constructor(private prisma: PrismaService) {}

  /**
   * Одноразовий беквіл: перераховує op.profit(Usd) і shift.profit(Usd) усієї
   * історії за $-числовником (щоб історичні фінанси збігалися з новою моделлю)
   * і переписує собівартість кожної каси в новому форматі. Старі гривневі
   * рядки DeskCostBasis — вихід СТАРОЇ моделі, як вхід ігноруються.
   * Ідемпотентний — можна запускати повторно.
   */
  async backfillAll() {
    const desks = await this.prisma.cashDesk.findMany({
      include: { exchangePoint: { select: { id: true } } },
    });
    let shiftsDone = 0;
    for (const desk of desks) {
      const [buyRates, timeline] = await Promise.all([
        this.getBuyRates(desk.exchangePointId),
        this.getUsdTimeline(desk.exchangePointId),
      ]);
      const shifts = await this.prisma.shift.findMany({
        where: { cashDeskId: desk.id },
        orderBy: { openedAt: 'asc' },
        include: { operations: true, usdtOperations: true, cashMovements: true },
      });
      // Переноситься між змінами каси; людський формат (UAH ₴/$, інші $-крос).
      let basis: Record<string, number> = {};

      for (const shift of shifts) {
        const res = await this.computeShift({
          cashDeskId: desk.id,
          exchangePointId: desk.exchangePointId,
          startBalance: (shift.startBalance as Record<string, number>) ?? {},
          operations: shift.operations as any,
          cashMovements: shift.cashMovements as any,
          usdtOperations: shift.usdtOperations as any,
          openedAt: shift.openedAt,
          closedAt: shift.closedAt,
          basisOverride: basis,
          buyRates,
          timeline,
        });

        // op.profitUsd (нативний) + op.profit (₴-знімок за курсом моменту операції).
        await this.prisma.$transaction(
          res.ops.map((o: any, i: number) =>
            this.prisma.operation.update({
              where: { id: o.id },
              data: { profitUsd: res.perOp[i], profit: res.perOp[i] * res.sUsdPerOp[i] },
            }),
          ),
        );

        basis = this.endingToHumanBasis(res.ending, basis);

        // Підсумки закритих змін — щоб історичні звіти/фінанси відповідали моделі.
        if (shift.status === 'CLOSED') {
          const usdtUsd = usdtProfitUsd(shift.usdtOperations as any);
          const usdtUah = usdtProfit(shift.usdtOperations as any);
          const profitUsd = res.totalRealized + usdtUsd;
          const profitUah =
            res.ops.reduce((s: number, _o: any, i: number) => s + res.perOp[i] * res.sUsdPerOp[i], 0) + usdtUah;

          const byCurrencyUsd: Record<string, number> = { ...res.byCurrency };
          if (Math.abs(usdtUsd) >= 0.005) byCurrencyUsd.USDT = usdtUsd;
          // ₴-розбивка: по-операційні знімки, згруповані за валютою операції.
          const byCurrencyUah: Record<string, number> = {};
          res.ops.forEach((o: any, i: number) => {
            const v = res.perOp[i] * res.sUsdPerOp[i];
            if (Math.abs(v) < 0.005) return;
            byCurrencyUah[o.currency] = (byCurrencyUah[o.currency] ?? 0) + v;
          });
          if (Math.abs(usdtUah) >= 0.005) byCurrencyUah.USDT = usdtUah;

          const sClose = shift.closedAt ? timeline.at(shift.closedAt)?.sell ?? 0 : 0;
          // Нестача/надлишок каси старої моделі (₴) — стабільна різниця, переносимо.
          const oldSurplus =
            shift.factualProfit != null ? Number(shift.factualProfit) - Number(shift.profit) : null;

          const endBalance = (shift.endBalance as Record<string, number>) ?? {};
          const till = tillUsdValue(endBalance, basis);

          await this.prisma.shift.update({
            where: { id: shift.id },
            data: {
              profit: profitUah,
              profitUsd,
              profitByCurrency: byCurrencyUah,
              profitByCurrencyUsd: byCurrencyUsd,
              costBasis: basis,
              usdSellAtClose: sClose || null,
              // Історичний баланс USDT-гаманця невідновний — чесно позначаємо.
              tillUsd: { byCurrency: till.byCurrency, total: till.total, usdSellRate: sClose, usdtIncluded: false },
              factualProfit: oldSurplus != null ? profitUah + oldSurplus : profitUah,
              factualProfitUsd:
                oldSurplus != null && sClose > 0 ? profitUsd + oldSurplus / sClose : profitUsd,
            },
          });
        }
        shiftsDone += 1;
      }

      // Кінцева собівартість каси — повний перезапис у новому форматі.
      await this.prisma.deskCostBasis.deleteMany({ where: { cashDeskId: desk.id } });
      const rows = Object.entries(basis)
        .filter(([cur, v]) => !isNumeraire(cur) && v > 0)
        .map(([currency, v]) => ({ cashDeskId: desk.id, currency, avgCost: v }));
      if (rows.length) await this.prisma.deskCostBasis.createMany({ data: rows });
    }
    this.logger.log(`$-беквіл: оброблено кас=${desks.length}, змін=${shiftsDone}`);
    return { desks: desks.length, shifts: shiftsDone };
  }

  /**
   * Збережена середня собівартість каси по валютах — людський формат:
   * UAH — сер. курс ₴ за $ (напр. 44.95), інші — $-крос за одиницю (EUR 1.1420).
   */
  async getBasis(cashDeskId: number): Promise<Record<string, number>> {
    const rows = await this.prisma.deskCostBasis.findMany({ where: { cashDeskId } });
    const map: Record<string, number> = {};
    for (const r of rows) map[r.currency] = Number(r.avgCost);
    return map;
  }

  /** Поточні курси КУПІВЛІ точки (fallback для валют без перенесеної собівартості). */
  async getBuyRates(exchangePointId: number): Promise<Record<string, number>> {
    const rates = await this.prisma.rate.findMany({
      where: { exchangePointId, status: 'ACTIVE' },
      select: { currency: true, buy: true },
    });
    const map: Record<string, number> = {};
    for (const r of rates) map[r.currency] = Number(r.buy);
    return map;
  }

  /**
   * Таймлайн курсу USD точки (уся історія Rate, ACTIVE+INACTIVE): курс продажу
   * USD на момент КОЖНОЇ операції — основа $-числовника. Зміна курсу вдень не
   * переписує прибуток попередніх операцій.
   */
  async getUsdTimeline(exchangePointId: number): Promise<RateTimeline> {
    const rows = await this.prisma.rate.findMany({
      where: { exchangePointId, currency: NUMERAIRE },
      select: { buy: true, sell: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return buildRateTimeline(rows);
  }

  /** Кінцева позиція двигуна → людський формат бази (поверх попередньої). */
  private endingToHumanBasis(
    ending: PositionMap,
    prev: Record<string, number>,
  ): Record<string, number> {
    const basis = { ...prev };
    for (const [cur, p] of Object.entries(ending)) {
      if (isNumeraire(cur) || !(p.avgCost > 0)) continue;
      basis[cur] = cur === 'UAH' ? costToUahBasis(p.avgCost) : p.avgCost;
    }
    return basis;
  }

  /**
   * Реалізований прибуток зміни за $-числовником. `operations` — усі операції
   * зміни (сортуємо за createdAt). Повертає прибуток ($), розбивку по валютах,
   * реалізований прибуток кожної операції та курс продажу USD на момент кожної
   * операції (для ₴-знімків), кінцеву позицію (включно з UAH).
   */
  async computeShift(params: {
    cashDeskId: number;
    exchangePointId: number;
    startBalance: Record<string, number>;
    operations: (WacOperation & { id?: number; createdAt?: Date | string })[];
    // Неторгові рухи валюти зміни. Без них продана «підкріплена» валюта
    // відкривала коротку позицію: прибуток 0, а собівартість підмінялась ціною
    // продажу. Передачі беруться з БД (потрібен час підтвердження).
    cashMovements?: CashMovementRow[];
    // Готівкові розрахунки USDT-вікна: рухають гривню/валюту каси — з гривнею-
    // позицією їх ігнорування було б витоком бази.
    usdtOperations?: UsdtOpRow[];
    openedAt?: Date;
    closedAt?: Date | null;
    // Для беквілу: база/курси/таймлайн передаються ззовні (без читання з БД).
    basisOverride?: Record<string, number>;
    buyRates?: Record<string, number>;
    timeline?: RateTimeline;
  }) {
    const [basis, buyRates, timeline] = await Promise.all([
      params.basisOverride ?? this.getBasis(params.cashDeskId),
      params.buyRates ?? this.getBuyRates(params.exchangePointId),
      params.timeline ?? this.getUsdTimeline(params.exchangePointId),
    ]);

    const sAt = (t: Date | string | number | undefined | null): number => {
      const rate = timeline.at(t ? new Date(t) : new Date());
      return rate?.sell && rate.sell > 0 ? rate.sell : 0;
    };
    const sOpen = sAt(params.openedAt);

    // Відкриваюча позиція: к-сть із фактичного залишку, собівартість — перенесена
    // (людський формат → внутрішній $), fallback — від поточних курсів точки.
    const opening: PositionMap = {};
    const currencies = new Set<string>([
      'UAH',
      ...Object.keys(params.startBalance ?? {}),
      ...Object.keys(basis),
      ...params.operations.map((o) => o.currency),
      ...params.operations.map((o) => (o.payCurrency ?? '') as string),
    ]);
    // Знаменник кросів — сер. курс гривні (правило власника: злотий 11.80 при
    // гривні по 44.90 → 11.80/44.90); без нього — поточний курс продажу USD.
    const uahPerUsd = basis.UAH > 0 ? basis.UAH : sOpen;
    for (const cur of currencies) {
      // Долари всіх видів (USD/USDW/USDG/USDT) — числовник, позиції не мають.
      if (!cur || isNumeraire(cur)) continue;
      const qty = Number(params.startBalance?.[cur] ?? 0);
      let avgCost: number;
      if (cur === 'UAH') {
        // Сер. курс гривні: перенесений (₴/$) або поточний курс продажу USD.
        avgCost = uahPerUsd > 0 ? uahBasisToCost(uahPerUsd) : 0;
      } else {
        // $-крос: перенесений або buy(cur)/сер.курс — собівартості немає,
        // бо купівлі не було; нуль дав би фантомний прибуток на весь продаж.
        avgCost =
          basis[cur] > 0 ? basis[cur] : buyRates[cur] > 0 && uahPerUsd > 0 ? buyRates[cur] / uahPerUsd : 0;
      }
      opening[cur] = { qty, avgCost };
    }

    const ops = [...params.operations].sort(
      (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
    );
    const sUsdPerOp = ops.map((op) => sAt(op.createdAt));

    // Хронологія зміни: операції + неторгові рухи валюти. Порядок важливий —
    // підкріплення має потрапити в позицію ДО продажу підкріпленої валюти.
    const flows = await this.buildFlows(params, buyRates, sAt);
    const items: WacItem[] = [
      ...ops.map((op, i) => ({
        at: new Date(op.createdAt ?? 0).getTime(),
        item: { kind: 'op' as const, op, sUsd: sUsdPerOp[i] },
      })),
      ...flows,
    ]
      .sort((a, b) => a.at - b.at)
      .map((x) => x.item);

    const res = wacRealizedTimeline(opening, items);
    return { ...res, ops, sUsdPerOp };
  }

  /**
   * Неторгові рухи валюти зміни (для позиції, у $-цінах):
   *   • підкріплення (IN) / отримана передача → валюта заходить за
   *     buy(cur)/S, гривня — за 1/S (реальної собівартості немає — купівлі не було);
   *   • інкасація (OUT) / відправлена передача → зменшує запас за базою (без прибутку);
   *   • готівкові розрахунки USDT-вікна (SELL → готівка приходить, BUY → йде).
   * USD (числовник) і USDT (віртуальний гаманець) — пропускаються.
   */
  private async buildFlows(
    params: {
      cashDeskId: number;
      cashMovements?: CashMovementRow[];
      usdtOperations?: UsdtOpRow[];
      openedAt?: Date;
      closedAt?: Date | null;
    },
    buyRates: Record<string, number>,
    sAt: (t: Date | string | number | undefined | null) => number,
  ): Promise<{ at: number; item: WacItem }[]> {
    const out: { at: number; item: WacItem }[] = [];
    const push = (at: Date | string, currency: string, qty: number) => {
      if (!currency || isNumeraire(currency) || !qty) return;
      const S = sAt(at);
      const price =
        currency === 'UAH'
          ? S > 0 ? 1 / S : 0
          : S > 0 && buyRates[currency] > 0 ? buyRates[currency] / S : 0;
      out.push({ at: new Date(at).getTime(), item: { kind: 'flow', currency, qty, price } });
    };

    for (const m of params.cashMovements ?? []) {
      const amt = Number((m as any).amount);
      push((m as any).createdAt, m.currency, m.direction === 'IN' ? amt : -amt);
    }

    for (const u of params.usdtOperations ?? []) {
      if (u.cancelled || !u.createdAt) continue;
      const amt = Number(u.settleAmount);
      // SELL: каса продає USDT → готівка ПРИХОДИТЬ; BUY: каса купує → готівка йде.
      push(u.createdAt, u.settleCurrency, u.side === 'SELL' ? amt : -amt);
    }

    if (params.openedAt) {
      const transfers = await this.prisma.transfer.findMany({
        where: {
          status: 'CONFIRMED',
          confirmedAt: params.closedAt
            ? { gte: params.openedAt, lte: params.closedAt }
            : { gte: params.openedAt },
          OR: [{ fromDeskId: params.cashDeskId }, { toDeskId: params.cashDeskId }],
        },
        select: {
          currency: true, amount: true, fromDeskId: true, toDeskId: true,
          counterCurrency: true, counterAmount: true, confirmedAt: true,
        },
      });
      for (const t of transfers) {
        if (!t.confirmedAt) continue;
        const incoming = t.toDeskId === params.cashDeskId;
        const amt = Number(t.amount);
        push(t.confirmedAt, t.currency, incoming ? amt : -amt);
        // Своп: зустрічне плече йде у зворотному напрямку.
        if (t.counterCurrency && t.counterAmount != null) {
          const cAmt = Number(t.counterAmount);
          push(t.confirmedAt, t.counterCurrency, incoming ? -cAmt : cAmt);
        }
      }
    }

    return out;
  }

  /**
   * Перераховує реалізований прибуток кожної операції зміни і зберігає
   * op.profitUsd (нативний $) + op.profit (₴-знімок за курсом моменту операції).
   * Викликається після створення/сторно/редагування операції, щоб живий
   * підрахунок каси й фінанси одразу відображали правильний прибуток.
   * Собівартість НЕ переносимо тут (лише при закритті зміни).
   */
  async recomputeShiftOps(shiftId: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { cashDesk: true, operations: true, cashMovements: true, usdtOperations: true },
    });
    if (!shift) return;
    const res = await this.computeShift({
      cashDeskId: shift.cashDeskId,
      exchangePointId: shift.cashDesk.exchangePointId,
      startBalance: (shift.startBalance as Record<string, number>) ?? {},
      operations: shift.operations as any,
      cashMovements: shift.cashMovements as any,
      usdtOperations: shift.usdtOperations as any,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
    });
    // Пишемо лише ті операції, де прибуток реально змінився: перерахунок робиться
    // після КОЖНОЇ операції, тож без цієї відсічки зміна на 90 операцій давала б
    // тисячі зайвих UPDATE (квадратично від кількості операцій).
    const updates = res.ops
      .map((o: any, i: number) => {
        const usd = res.perOp[i];
        const uah = usd * res.sUsdPerOp[i];
        return o.id != null &&
          (Math.abs(Number(o.profitUsd ?? 0) - usd) >= 0.005 ||
            Math.abs(Number(o.profit ?? 0) - uah) >= 0.005)
          ? { id: o.id, profitUsd: usd, profit: uah }
          : null;
      })
      .filter((x): x is { id: number; profitUsd: number; profit: number } => x != null);
    if (updates.length) {
      await this.prisma.$transaction(
        updates.map((u) =>
          this.prisma.operation.update({
            where: { id: u.id },
            data: { profitUsd: u.profitUsd, profit: u.profit },
          }),
        ),
      );
    }
  }

  /**
   * Задати середню собівартість каси (сер. курс), яку касир редагує у формі
   * відкриття/закриття зміни. Людський формат: UAH — ₴ за $ (44.95), інші —
   * $-крос (EUR 1.1420). Застосовує введені додатні значення (upsert) — поле в
   * UI дефолтиться поточною перенесеною собівартістю, тож касир зазвичай лишає
   * його як є (no-op), а свідома правка перезаписує. USD (числовник) і USDT
   * ігноруються. Порожні/недодатні валюти не чіпаємо.
   */
  async setBasis(cashDeskId: number, costBasis: Record<string, number>) {
    const ops = Object.entries(costBasis)
      .filter(([cur, v]) => !isNumeraire(cur) && Number(v) > 0)
      .map(([currency, v]) =>
        this.prisma.deskCostBasis.upsert({
          where: { cashDeskId_currency: { cashDeskId, currency } },
          create: { cashDeskId, currency, avgCost: Number(v) },
          update: { avgCost: Number(v) },
        }),
      );
    if (ops.length) await this.prisma.$transaction(ops);
  }

}
