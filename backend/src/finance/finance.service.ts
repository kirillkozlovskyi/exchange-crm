import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { midRates, realizedProfit } from '../common/profit.util';
import { usdtProfit } from '../common/usdt.util';

/**
 * Фінансові підсумки по точках. Прибуток — ЄДИНА модель із закриттям зміни:
 * реалізований спред «з відкупу» (realizedProfit) + чиста маржа USDT.
 * Раніше тут підсумовувався op.profit по операціях — стара модель, що подвійно
 * рахувала спред і не знала про USDT; звіти розходились із закритими змінами.
 */
@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async getDailySummary(date: Date = new Date()) {
    return this.summary(startOfDay(date), endOfDay(date));
  }

  async getWeeklySummary(date: Date = new Date()) {
    return this.summary(startOfWeek(date, { weekStartsOn: 1 }), endOfWeek(date, { weekStartsOn: 1 }));
  }

  async getMonthlySummary(date: Date = new Date()) {
    return this.summary(startOfMonth(date), endOfMonth(date));
  }

  private async summary(from: Date, to: Date) {
    const [operations, usdtOps, rates] = await Promise.all([
      this.prisma.operation.findMany({
        // Скасовані (сторно) не входять у фінансові підсумки.
        where: { createdAt: { gte: from, lte: to }, cancelled: false },
        include: { shift: { include: { cashDesk: { include: { exchangePoint: true } } } } },
      }),
      this.prisma.usdtOperation.findMany({
        where: { createdAt: { gte: from, lte: to } },
        include: { cashDesk: { include: { exchangePoint: true } } },
      }),
      // Оцінка крос-операцій — за поточними ACTIVE-курсами точки (як у closeShift).
      this.prisma.rate.findMany({ where: { status: 'ACTIVE' } }),
    ]);

    // Серединні курси по кожній точці.
    const valuationByPoint: Record<number, Record<string, number>> = {};
    for (const r of rates) {
      (valuationByPoint[r.exchangePointId] ??= { UAH: 1 });
      valuationByPoint[r.exchangePointId][r.currency] =
        (Number(r.buy) + Number(r.sell)) / 2;
    }

    type PointAgg = {
      pointName: string;
      totalProfit: number;
      operationsCount: number;
      byCurrency: Record<string, { volume: number; profit: number }>;
      _ops: typeof operations;
    };
    const byPoint: Record<string, PointAgg> = {};
    const pointOf = (op: { shift?: any; cashDesk?: any }) =>
      op.shift?.cashDesk?.exchangePoint ?? op.cashDesk?.exchangePoint;

    const ensure = (point: { id: number; name: string }): PointAgg =>
      (byPoint[String(point.id)] ??= {
        pointName: point.name,
        totalProfit: 0,
        operationsCount: 0,
        byCurrency: {},
        _ops: [],
      });

    // Групуємо операції по точках (обʼєми — одразу).
    for (const op of operations) {
      const point = pointOf(op);
      if (!point) continue;
      const agg = ensure(point);
      agg._ops.push(op);
      agg.operationsCount += 1;
      (agg.byCurrency[op.currency] ??= { volume: 0, profit: 0 });
      agg.byCurrency[op.currency].volume += Number(op.amount);
    }

    // Реалізований прибуток по кожній точці + розбивка по валютах.
    for (const [pointId, agg] of Object.entries(byPoint)) {
      const valuation = valuationByPoint[Number(pointId)] ?? { UAH: 1 };
      const realized = realizedProfit(agg._ops, valuation);
      agg.totalProfit += realized.total;
      for (const [cur, profit] of Object.entries(realized.byCurrency)) {
        (agg.byCurrency[cur] ??= { volume: 0, profit: 0 });
        agg.byCurrency[cur].profit += profit;
      }
    }

    // USDT: чиста маржа (profitUah) + обʼєм, окремим рядком «USDT».
    for (const uop of usdtOps) {
      const point = pointOf(uop);
      if (!point) continue;
      const agg = ensure(point);
      const margin = usdtProfit([uop as any]);
      agg.operationsCount += 1;
      agg.totalProfit += margin;
      (agg.byCurrency.USDT ??= { volume: 0, profit: 0 });
      agg.byCurrency.USDT.volume += Number(uop.usdtAmount);
      agg.byCurrency.USDT.profit += margin;
    }

    const points = Object.values(byPoint).map(({ _ops, ...rest }) => rest);
    const totalProfit = points.reduce((s, p) => s + p.totalProfit, 0);
    return { totalProfit, points };
  }
}
