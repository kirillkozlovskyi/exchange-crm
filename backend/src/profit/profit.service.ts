import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { wacRealizedTimeline, WacItem, PositionMap, WacOperation } from '../common/wac-profit.util';
import { buybackMargin, SoldPoolMap, MarginOperation } from '../common/buyback-margin.util';
import { CashMovementRow } from '../common/cash-movements.util';
import { usdtProfit } from '../common/usdt.util';

/**
 * Собівартість валюти на відкриття зміни. Нульова перенесена собівартість —
 * НЕ дані, а слід повністю закритої позиції (avgCost скидається в 0). Якщо
 * валюта потім з'явиться в касі без купівлі (підкріплення, передача, ручне
 * коригування), нуль дав би фантомний прибуток на всю суму продажу — тому
 * падаємо на поточний курс купівлі точки.
 */
function openingCost(carried: number | undefined, buyRate: number | undefined): number {
  if (carried != null && carried > 0) return carried;
  return buyRate ?? 0;
}

/**
 * Прибуток за моделлю WAC (Варіант 1): позиція каси по валюті переноситься між
 * змінами через збережену середню собівартість (DeskCostBasis). Кількість на
 * відкриття зміни беремо з фактичного залишку (startBalance) — щоб позиція не
 * дрейфувала від передач/руху готівки; переноситься лише собівартість.
 */
@Injectable()
export class ProfitService {
  private readonly logger = new Logger(ProfitService.name);
  constructor(private prisma: PrismaService) {}

  /**
   * Одноразовий беквіл: перераховує op.profit і shift.profit усієї історії за
   * моделлю WAC (щоб історичні фінанси збігалися з новою моделлю), і виставляє
   * кінцеву собівартість кожної каси. Ідемпотентний — можна запускати повторно.
   */
  async backfillAll() {
    const desks = await this.prisma.cashDesk.findMany({
      include: { exchangePoint: { select: { id: true } } },
    });
    let shiftsDone = 0;
    for (const desk of desks) {
      const buyRates = await this.getBuyRates(desk.exchangePointId);
      const shifts = await this.prisma.shift.findMany({
        where: { cashDeskId: desk.id },
        orderBy: { openedAt: 'asc' },
        include: { operations: true, usdtOperations: true, cashMovements: true },
      });
      const basis: Record<string, number> = {}; // переноситься між змінами каси

      for (const shift of shifts) {
        const start = (shift.startBalance as Record<string, number>) ?? {};
        const opening: PositionMap = {};
        const currencies = new Set<string>([
          ...Object.keys(start),
          ...Object.keys(basis),
          ...shift.operations.map((o) => o.currency),
          ...shift.operations.map((o) => (o.payCurrency ?? '') as string),
        ]);
        for (const cur of currencies) {
          if (!cur || cur === 'UAH' || cur === 'USDT') continue;
          opening[cur] = {
            qty: Number(start[cur] ?? 0),
            avgCost: openingCost(basis[cur], buyRates[cur]),
          };
        }
        const ops = [...shift.operations].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        // Та сама хронологія, що й у живому розрахунку: операції + неторгові рухи.
        const flows = await this.buildFlows(
          {
            cashDeskId: desk.id,
            cashMovements: shift.cashMovements as any,
            openedAt: shift.openedAt,
            closedAt: shift.closedAt,
          },
          buyRates,
        );
        const items: WacItem[] = [
          ...ops.map((op) => ({ at: new Date(op.createdAt).getTime(), item: { kind: 'op' as const, op: op as any } })),
          ...flows,
        ]
          .sort((a, b) => a.at - b.at)
          .map((x) => x.item);
        const res = wacRealizedTimeline(opening, items);

        // op.profit
        await this.prisma.$transaction(
          ops.map((o, i) => this.prisma.operation.update({ where: { id: o.id }, data: { profit: res.perOp[i] } })),
        );

        // shift.profit (для закритих) — реалізований + маржа USDT.
        if (shift.status === 'CLOSED') {
          const usdtMargin = usdtProfit(shift.usdtOperations as any);
          const profitByCurrency: Record<string, number> = { ...res.byCurrency };
          if (Math.abs(usdtMargin) >= 0.005) profitByCurrency.USDT = usdtMargin;
          await this.prisma.shift.update({
            where: { id: shift.id },
            data: { profit: res.totalRealized + usdtMargin, profitByCurrency },
          });
        }

        for (const [cur, p] of Object.entries(res.ending)) basis[cur] = p.avgCost;
        shiftsDone += 1;
      }

      // Кінцева собівартість каси.
      const endingBasis: PositionMap = {};
      for (const [cur, avg] of Object.entries(basis)) endingBasis[cur] = { qty: 0, avgCost: avg };
      await this.saveBasis(desk.id, endingBasis);
    }
    this.logger.log(`WAC-беквіл: оброблено кас=${desks.length}, змін=${shiftsDone}`);
    return { desks: desks.length, shifts: shiftsDone };
  }

  /** Збережена середня собівартість каси по валютах (грн/од.). */
  async getBasis(cashDeskId: number): Promise<Record<string, number>> {
    const rows = await this.prisma.deskCostBasis.findMany({ where: { cashDeskId } });
    const map: Record<string, number> = {};
    for (const r of rows) map[r.currency] = Number(r.avgCost);
    return map;
  }

  /** Пул «проданої гривні, що чекає відкупу» (для маржі з відкупу). */
  async getSoldPool(cashDeskId: number): Promise<SoldPoolMap> {
    const rows = await this.prisma.deskSoldPool.findMany({ where: { cashDeskId } });
    const map: SoldPoolMap = {};
    for (const r of rows) map[r.currency] = { units: Number(r.units), uah: Number(r.uah) };
    return map;
  }

  /**
   * Маржа з відкупу за зміну (додатковий показник, модель замовника). Пул
   * переноситься між змінами каси; на фінанси не впливає.
   */
  async computeBuybackMargin(params: {
    cashDeskId: number;
    operations: (MarginOperation & { createdAt?: Date | string })[];
  }) {
    const opening = await this.getSoldPool(params.cashDeskId);
    const ops = [...params.operations].sort(
      (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
    );
    return buybackMargin(opening, ops);
  }

  /** Переносить пул проданої гривні на наступну зміну каси. */
  async saveSoldPool(cashDeskId: number, ending: SoldPoolMap) {
    const ops = Object.entries(ending)
      .filter(([cur]) => cur !== 'UAH')
      .map(([currency, p]) =>
        this.prisma.deskSoldPool.upsert({
          where: { cashDeskId_currency: { cashDeskId, currency } },
          create: { cashDeskId, currency, units: p.units, uah: p.uah },
          update: { units: p.units, uah: p.uah },
        }),
      );
    if (ops.length) await this.prisma.$transaction(ops);
  }

  /** Поточні курси КУПІВЛІ точки (для стартової собівартості валют без історії). */
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
   * Реалізований прибуток зміни за WAC. `operations` — усі операції зміни
   * (сортуємо за createdAt). Повертає прибуток, розбивку по валютах, реалізований
   * прибуток кожної операції (для збереження в op.profit) та кінцеву собівартість.
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
    openedAt?: Date;
    closedAt?: Date | null;
  }) {
    const [basis, buyRates] = await Promise.all([
      this.getBasis(params.cashDeskId),
      this.getBuyRates(params.exchangePointId),
    ]);

    // Відкриваюча позиція: к-сть із фактичного залишку, собівартість — перенесена
    // (або поточний курс купівлі, якщо історії ще немає).
    const opening: PositionMap = {};
    const currencies = new Set<string>([
      ...Object.keys(params.startBalance ?? {}),
      ...Object.keys(basis),
      ...params.operations.map((o) => o.currency),
      ...params.operations.map((o) => (o.payCurrency ?? '') as string),
    ]);
    for (const cur of currencies) {
      // USDT — не готівкова позиція каси: живе в окремому гаманці, торгується
      // лише через вікно USDT. Історичні хвости в startBalance не мають
      // створювати WAC-позицію (ризик фантомного прибутку зі стале-собівартості).
      if (!cur || cur === 'UAH' || cur === 'USDT') continue;
      const qty = Number(params.startBalance?.[cur] ?? 0);
      opening[cur] = { qty, avgCost: openingCost(basis[cur], buyRates[cur]) };
    }

    const ops = [...params.operations].sort(
      (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
    );

    // Хронологія зміни: операції + неторгові рухи валюти. Порядок важливий —
    // підкріплення має потрапити в позицію ДО продажу підкріпленої валюти.
    const flows = await this.buildFlows(params, buyRates);
    const items: WacItem[] = [
      ...ops.map((op) => ({ at: new Date(op.createdAt ?? 0).getTime(), item: { kind: 'op' as const, op } })),
      ...flows,
    ]
      .sort((a, b) => a.at - b.at)
      .map((x) => x.item);

    const res = wacRealizedTimeline(opening, items);
    return { ...res, ops };
  }

  /**
   * Неторгові рухи валюти зміни (для WAC-позиції):
   *   • підкріплення (IN) / отримана передача → валюта заходить у запас за
   *     ПОТОЧНИМ курсом купівлі точки (реальної собівартості немає — купівлі не було);
   *   • інкасація (OUT) / відправлена передача → просто зменшує запас (без прибутку).
   * Гривня не є позицією — пропускаємо.
   */
  private async buildFlows(
    params: {
      cashDeskId: number;
      cashMovements?: CashMovementRow[];
      openedAt?: Date;
      closedAt?: Date | null;
    },
    buyRates: Record<string, number>,
  ): Promise<{ at: number; item: WacItem }[]> {
    const out: { at: number; item: WacItem }[] = [];
    const push = (at: Date | string, currency: string, qty: number) => {
      if (!currency || currency === 'UAH' || currency === 'USDT' || !qty) return;
      out.push({
        at: new Date(at).getTime(),
        item: { kind: 'flow', currency, qty, price: buyRates[currency] ?? 0 },
      });
    };

    for (const m of params.cashMovements ?? []) {
      const amt = Number((m as any).amount);
      push((m as any).createdAt, m.currency, m.direction === 'IN' ? amt : -amt);
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
   * Перераховує реалізований прибуток кожної операції зміни за WAC і зберігає в
   * op.profit. Викликається після створення/сторно/редагування операції, щоб
   * живий підрахунок каси й фінанси одразу відображали правильний прибуток.
   * Собівартість НЕ переносимо тут (лише при закритті зміни).
   */
  async recomputeShiftOps(shiftId: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { cashDesk: true, operations: true, cashMovements: true },
    });
    if (!shift) return;
    const res = await this.computeShift({
      cashDeskId: shift.cashDeskId,
      exchangePointId: shift.cashDesk.exchangePointId,
      startBalance: (shift.startBalance as Record<string, number>) ?? {},
      operations: shift.operations as any,
      cashMovements: shift.cashMovements as any,
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
    });
    // Пишемо лише ті операції, де прибуток реально змінився: перерахунок робиться
    // після КОЖНОЇ операції, тож без цієї відсічки зміна на 90 операцій давала б
    // тисячі зайвих UPDATE (квадратично від кількості операцій).
    const updates = res.ops
      .map((o: any, i: number) =>
        o.id != null && Math.abs(Number(o.profit ?? 0) - res.perOp[i]) >= 0.005
          ? { id: o.id, profit: res.perOp[i] }
          : null,
      )
      .filter((x): x is { id: number; profit: number } => x != null);
    if (updates.length) {
      await this.prisma.$transaction(
        updates.map((u) => this.prisma.operation.update({ where: { id: u.id }, data: { profit: u.profit } })),
      );
    }
  }

  /**
   * Зберігає (переносить) середню собівартість каси після закриття зміни.
   * Нульову собівартість не пишемо: позиція закрита — старий запис лишається
   * як остання відома ціна, а нуль зробив би наступний продаж «чистим
   * прибутком» на всю суму (див. openingCost).
   */
  async saveBasis(cashDeskId: number, ending: PositionMap) {
    const ops = Object.entries(ending)
      .filter(([cur, p]) => cur !== 'UAH' && cur !== 'USDT' && p.avgCost > 0)
      .map(([currency, p]) =>
        this.prisma.deskCostBasis.upsert({
          where: { cashDeskId_currency: { cashDeskId, currency } },
          create: { cashDeskId, currency, avgCost: p.avgCost },
          update: { avgCost: p.avgCost },
        }),
      );
    if (ops.length) await this.prisma.$transaction(ops);
  }
}
