import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, format } from 'date-fns';
import { midRates, realizedProfit } from '../common/profit.util';
import { usdtProfit } from '../common/usdt.util';
import { ExpensesService } from '../expenses/expenses.service';

/**
 * Фінансові підсумки по точках. Прибуток — ЄДИНА модель із закриттям зміни:
 * реалізований спред «з відкупу» (realizedProfit) + чиста маржа USDT.
 * Раніше тут підсумовувався op.profit по операціях — стара модель, що подвійно
 * рахувала спред і не знала про USDT; звіти розходились із закритими змінами.
 */
@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private expenses: ExpensesService,
  ) {}

  async getDailySummary(date: Date = new Date()) {
    return this.summary(startOfDay(date), endOfDay(date));
  }

  async getWeeklySummary(date: Date = new Date()) {
    return this.summary(startOfWeek(date, { weekStartsOn: 1 }), endOfWeek(date, { weekStartsOn: 1 }));
  }

  async getMonthlySummary(date: Date = new Date()) {
    return this.summary(startOfMonth(date), endOfMonth(date));
  }

  /**
   * Серія «прибуток по днях» за останні N днів (для дашборда). Та сама модель,
   * що й summary: realizedProfit по точках + маржа USDT, згруповано по днях.
   */
  async getDailySeries(days = 14) {
    const n = Math.min(Math.max(Math.trunc(days) || 14, 1), 90);
    const to = endOfDay(new Date());
    const from = startOfDay(subDays(new Date(), n - 1));

    const [operations, usdtOps, rates] = await Promise.all([
      this.prisma.operation.findMany({
        where: { createdAt: { gte: from, lte: to }, cancelled: false },
        include: { shift: { include: { cashDesk: { select: { exchangePointId: true } } } } },
      }),
      this.prisma.usdtOperation.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { createdAt: true, profitUah: true },
      }),
      this.prisma.rate.findMany({ where: { status: 'ACTIVE' } }),
    ]);

    const valuationByPoint: Record<number, Record<string, number>> = {};
    for (const r of rates) {
      (valuationByPoint[r.exchangePointId] ??= { UAH: 1 });
      valuationByPoint[r.exchangePointId][r.currency] = (Number(r.buy) + Number(r.sell)) / 2;
    }

    // Групуємо по днях, всередині дня — по точках (для правильної оцінки кросів).
    const dayKey = (d: Date | string) => format(new Date(d), 'yyyy-MM-dd');
    const opsByDay: Record<string, Record<number, typeof operations>> = {};
    for (const op of operations) {
      const pid = op.shift?.cashDesk?.exchangePointId;
      if (pid == null) continue;
      ((opsByDay[dayKey(op.createdAt)] ??= {})[pid] ??= []).push(op);
    }
    const usdtByDay: Record<string, number> = {};
    for (const u of usdtOps) {
      usdtByDay[dayKey(u.createdAt)] = (usdtByDay[dayKey(u.createdAt)] ?? 0) + Number(u.profitUah);
    }

    const series: { date: string; profit: number; operations: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const key = format(subDays(new Date(), i), 'yyyy-MM-dd');
      let profit = usdtByDay[key] ?? 0;
      let count = 0;
      for (const [pid, ops] of Object.entries(opsByDay[key] ?? {})) {
        profit += realizedProfit(ops, valuationByPoint[Number(pid)] ?? { UAH: 1 }).total;
        count += ops.length;
      }
      series.push({ date: key, profit: Math.round(profit * 100) / 100, operations: count });
    }
    return series;
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

    // Витрати по точках за період → чистий прибуток = валовий − витрати.
    const expensesByPoint = await this.expenses.sumByPoint(from, to);

    // Точки, де були лише витрати (без операцій), теж показуємо.
    const missingIds = Object.keys(expensesByPoint)
      .map(Number)
      .filter((id) => !byPoint[String(id)]);
    if (missingIds.length) {
      const pts = await this.prisma.exchangePoint.findMany({
        where: { id: { in: missingIds } },
        select: { id: true, name: true },
      });
      for (const p of pts) ensure(p);
    }

    // Прив'язуємо витрати й чистий прибуток по кожній точці за id.
    const points = Object.entries(byPoint).map(([pid, agg]) => {
      const { _ops, ...rest } = agg;
      const expenses = expensesByPoint[Number(pid)] ?? 0;
      return { ...rest, expenses, netProfit: rest.totalProfit - expenses };
    });

    const totalProfit = points.reduce((s, p) => s + p.totalProfit, 0);
    const totalExpenses = points.reduce((s, p) => s + p.expenses, 0);
    const totalNetProfit = totalProfit - totalExpenses;
    return { totalProfit, totalExpenses, totalNetProfit, points };
  }
}
