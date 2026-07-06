import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { wacRealized, PositionMap, WacOperation } from '../common/wac-profit.util';
import { usdtProfit } from '../common/usdt.util';

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
        include: { operations: true, usdtOperations: true },
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
          if (!cur || cur === 'UAH') continue;
          opening[cur] = { qty: Number(start[cur] ?? 0), avgCost: basis[cur] ?? buyRates[cur] ?? 0 };
        }
        const ops = [...shift.operations].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        const res = wacRealized(opening, ops as any);

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
      if (!cur || cur === 'UAH') continue;
      const qty = Number(params.startBalance?.[cur] ?? 0);
      const avgCost = basis[cur] ?? buyRates[cur] ?? 0;
      opening[cur] = { qty, avgCost };
    }

    const ops = [...params.operations].sort(
      (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime(),
    );
    const res = wacRealized(opening, ops);
    return { ...res, ops };
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
      include: { cashDesk: true, operations: true },
    });
    if (!shift) return;
    const res = await this.computeShift({
      cashDeskId: shift.cashDeskId,
      exchangePointId: shift.cashDesk.exchangePointId,
      startBalance: (shift.startBalance as Record<string, number>) ?? {},
      operations: shift.operations as any,
    });
    const updates = res.ops
      .map((o: any, i: number) => (o.id != null ? { id: o.id, profit: res.perOp[i] } : null))
      .filter((x): x is { id: number; profit: number } => x != null);
    if (updates.length) {
      await this.prisma.$transaction(
        updates.map((u) => this.prisma.operation.update({ where: { id: u.id }, data: { profit: u.profit } })),
      );
    }
  }

  /** Зберігає (переносить) середню собівартість каси після закриття зміни. */
  async saveBasis(cashDeskId: number, ending: PositionMap) {
    const ops = Object.entries(ending)
      .filter(([cur]) => cur !== 'UAH')
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
