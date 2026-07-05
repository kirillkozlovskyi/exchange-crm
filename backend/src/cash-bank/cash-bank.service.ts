import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsdtService } from '../usdt/usdt.service';
import { shiftCashBalance, confirmedTransfersNetForDesk } from '../common/shift-ledger.util';

// Клієнт БД: звичайний або транзакційний (щоб рух банку можна було включити
// в одну транзакцію з рухом готівки каси).
type Db = PrismaService | Prisma.TransactionClient;

/**
 * Глобальний банк готівки компанії — мультивалютний резерв. Звідси готівка
 * розподіляється на каси (підкріплення) і сюди інкасується. Усі зміни балансу —
 * атомарні (upsert increment / conditional decrement), без гонок.
 *
 * USDT ведеться в UsdtGlobalWallet (механіка незмінна), але показується поруч
 * у getBalances — «частина банку» на одній сторінці.
 */
@Injectable()
export class CashBankService {
  constructor(
    private prisma: PrismaService,
    private usdt: UsdtService,
  ) {}

  // Баланси банку по валютах + USDT-гаманець поруч (для сторінки «Банк»).
  async getBalances() {
    const [rows, usdtGlobal] = await Promise.all([
      this.prisma.cashBankBalance.findMany({ orderBy: { currency: 'asc' } }),
      this.usdt.getGlobalWallet(),
    ]);
    return {
      currencies: rows.map((r) => ({ currency: r.currency, amount: Number(r.amount) })),
      usdt: Number(usdtGlobal.balance),
    };
  }

  // Атомарне поповнення банку (amount > 0).
  private async credit(currency: string, amount: number, db: Db = this.prisma) {
    await db.cashBankBalance.upsert({
      where: { currency },
      create: { currency, amount },
      update: { amount: { increment: amount } },
    });
  }

  // Атомарне зняття з банку (amount > 0), блокує від'ємний баланс.
  private async debit(currency: string, amount: number, db: Db = this.prisma) {
    const res = await db.cashBankBalance.updateMany({
      where: { currency, amount: { gte: amount } },
      data: { amount: { decrement: amount } },
    });
    if (res.count === 0) {
      const have = await db.cashBankBalance.findUnique({ where: { currency } });
      throw new BadRequestException(
        `Недостатньо ${currency} у банку: є ${Number(have?.amount ?? 0).toFixed(2)}, потрібно ${amount.toFixed(2)}`,
      );
    }
  }

  private log(
    type: string,
    currency: string,
    delta: number,
    userId: number,
    cashDeskId?: number,
    note?: string,
    db: Db = this.prisma,
  ) {
    return db.cashBankMovement.create({
      data: { type, currency, delta, note: note ?? null, cashDeskId: cashDeskId ?? null, createdById: userId },
    });
  }

  // Адмін: депозит готівки в банк (ззовні).
  async deposit(dto: { currency: string; amount: number; note?: string }, userId: number) {
    const amount = Number(dto.amount);
    if (!dto.currency) throw new BadRequestException('Не вказано валюту');
    if (!(amount > 0)) throw new BadRequestException('Сума має бути більшою за 0');
    await this.credit(dto.currency, amount);
    await this.log('DEPOSIT', dto.currency, amount, userId, undefined, dto.note);
    return this.getBalances();
  }

  // Адмін: зняття готівки з банку (назовні).
  async withdraw(dto: { currency: string; amount: number; note?: string }, userId: number) {
    const amount = Number(dto.amount);
    if (!dto.currency) throw new BadRequestException('Не вказано валюту');
    if (!(amount > 0)) throw new BadRequestException('Сума має бути більшою за 0');
    await this.debit(dto.currency, amount);
    await this.log('WITHDRAW', dto.currency, -amount, userId, undefined, dto.note);
    return this.getBalances();
  }

  /**
   * Рух банку внаслідок підкріплення/інкасації каси з контрагентом BANK.
   *  • IN  (підкріплення каси з банку) → банк ↓ (REPLENISH)
   *  • OUT (інкасація каси в банк)     → банк ↑ (COLLECT)
   * Викликається з CashMovementsService ВСЕРЕДИНІ його транзакції (передавайте
   * tx!) — щоб рух банку і рух готівки каси були атомарні: падіння створення
   * CashMovement відкочує і банк. Для IN валідує достатність у банку.
   */
  async applyForCashMovement(
    p: {
      direction: 'IN' | 'OUT';
      currency: string;
      amount: number;
      cashDeskId: number;
      userId: number;
      note?: string;
    },
    db: Db = this.prisma,
  ) {
    const amount = Number(p.amount);
    if (p.direction === 'IN') {
      await this.debit(p.currency, amount, db);
      await this.log('REPLENISH', p.currency, -amount, p.userId, p.cashDeskId, p.note, db);
    } else {
      await this.credit(p.currency, amount, db);
      await this.log('COLLECT', p.currency, amount, p.userId, p.cashDeskId, p.note, db);
    }
  }

  /**
   * Загальний баланс компанії = Банк + Σ поточної готівки всіх кас (по валютах).
   * Готівка каси: відкрита зміна → її поточний залишок (старт + операції + рух
   * готівки + USDT-готівка + передачі); закрита → останній кінцевий залишок.
   * USDT рахується окремо: глобальний гаманець + гаманці точок.
   */
  async getCompanyBalance() {
    const [bankRows, desks, gWallet, pWallets] = await Promise.all([
      this.prisma.cashBankBalance.findMany(),
      this.prisma.cashDesk.findMany({
        include: {
          shifts: {
            where: { status: 'OPEN' },
            include: { operations: true, cashMovements: true, usdtOperations: true },
          },
        },
      }),
      this.usdt.getGlobalWallet(),
      this.prisma.usdtWallet.findMany(),
    ]);

    const bank: Record<string, number> = {};
    for (const r of bankRows) bank[r.currency] = Number(r.amount);

    const desksTotal: Record<string, number> = {};
    const addTo = (acc: Record<string, number>, cur: string, amt: number) => {
      acc[cur] = (acc[cur] ?? 0) + amt;
    };

    for (const desk of desks) {
      const open = desk.shifts[0];
      let cur: Record<string, number>;
      if (open) {
        // Єдиний ledger-розрахунок поточної готівки зміни.
        cur = shiftCashBalance(
          {
            startBalance: (open.startBalance as Record<string, number>) ?? {},
            operations: open.operations,
            cashMovements: open.cashMovements,
            usdtOperations: open.usdtOperations as any,
          },
          await confirmedTransfersNetForDesk(this.prisma, desk.id, open.openedAt),
        );
      } else {
        const last = await this.prisma.shift.findFirst({
          where: { cashDeskId: desk.id, status: 'CLOSED' },
          orderBy: { closedAt: 'desc' },
          select: { endBalance: true },
        });
        cur = (last?.endBalance as Record<string, number>) ?? {};
      }
      for (const [c, amt] of Object.entries(cur)) addTo(desksTotal, c, Number(amt));
    }

    const total: Record<string, number> = { ...bank };
    for (const [c, amt] of Object.entries(desksTotal)) addTo(total, c, amt);

    const usdtPoints = pWallets.reduce((s, w) => s + Number(w.balance), 0);
    const usdtGlobal = Number(gWallet.balance);

    return {
      bank,
      desks: desksTotal,
      total,
      usdt: { global: usdtGlobal, points: usdtPoints, total: usdtGlobal + usdtPoints },
    };
  }

  // Журнал рухів банку (адмін/старший).
  async getMovements(limit = 200) {
    return this.prisma.cashBankMovement.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        createdBy: { select: { name: true } },
        cashDesk: { include: { exchangePoint: { select: { name: true } } } },
      },
    });
  }
}
