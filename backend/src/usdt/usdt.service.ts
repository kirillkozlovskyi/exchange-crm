import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { applyOperationsToBalance } from '../common/balance.util';
import { applyCashMovements } from '../common/cash-movements.util';
import { usdtCashDelta } from '../common/usdt.util';

type Side = 'BUY' | 'SELL';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class UsdtService {
  constructor(private prisma: PrismaService) {}

  // Гаманець точки: створюємо з нулями, якщо ще немає.
  async getWallet(exchangePointId: number) {
    return this.prisma.usdtWallet.upsert({
      where: { exchangePointId },
      create: { exchangePointId },
      update: {},
    });
  }

  // Усі гаманці (адмінка) з назвою точки.
  async getWallets() {
    const points = await this.prisma.exchangePoint.findMany({
      include: { usdtWallet: true },
      orderBy: { code: 'asc' },
    });
    return points.map((p) => ({
      exchangePointId: p.id,
      pointName: p.name,
      pointCode: p.code,
      balance: p.usdtWallet ? Number(p.usdtWallet.balance) : 0,
      buyPct: p.usdtWallet ? Number(p.usdtWallet.buyPct) : 0,
      sellPct: p.usdtWallet ? Number(p.usdtWallet.sellPct) : 0,
    }));
  }

  // Налаштування комісій (адмін): окремо купівля/продаж, до 4 знаків.
  // Відʼємні відсотки дозволені (напр. знижка/від'ємна маржа).
  async setPct(exchangePointId: number, dto: { buyPct?: number; sellPct?: number }) {
    const buyPct = Number(dto.buyPct ?? 0);
    const sellPct = Number(dto.sellPct ?? 0);
    if (Number.isNaN(buyPct) || Number.isNaN(sellPct))
      throw new BadRequestException('Некоректний відсоток');
    return this.prisma.usdtWallet.upsert({
      where: { exchangePointId },
      create: { exchangePointId, buyPct, sellPct },
      update: { buyPct, sellPct },
    });
  }

  // Ручне коригування балансу гаманця (адмін): депозит/зняття USDT.
  async adjustBalance(exchangePointId: number, delta: number) {
    const wallet = await this.getWallet(exchangePointId);
    const next = Number(wallet.balance) + Number(delta);
    if (next < 0) throw new BadRequestException('Баланс гаманця не може стати відʼємним');
    return this.prisma.usdtWallet.update({
      where: { exchangePointId },
      data: { balance: next },
    });
  }

  // ── Глобальний гаманець USDT (singleton id=1) ─────────────────────────────
  async getGlobalWallet() {
    return this.prisma.usdtGlobalWallet.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  // Ручне коригування глобального балансу (депозит/зняття USDT).
  async adjustGlobal(delta: number) {
    const g = await this.getGlobalWallet();
    const next = Number(g.balance) + Number(delta);
    if (next < 0) throw new BadRequestException('Глобальний баланс не може стати відʼємним');
    return this.prisma.usdtGlobalWallet.update({ where: { id: 1 }, data: { balance: next } });
  }

  // Джерело USDT для операцій кас: 'POINT' (гаманець точки) або 'GLOBAL'.
  async getSource(): Promise<'POINT' | 'GLOBAL'> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'usdt_source' } });
    return s?.value === 'GLOBAL' ? 'GLOBAL' : 'POINT';
  }

  async setSource(source: 'POINT' | 'GLOBAL') {
    const value = source === 'GLOBAL' ? 'GLOBAL' : 'POINT';
    await this.prisma.setting.upsert({
      where: { key: 'usdt_source' },
      create: { key: 'usdt_source', value },
      update: { value },
    });
    return { source: value };
  }

  // Загальний стан USDT для адмінки/каси: джерело + глобальний баланс.
  async getConfig() {
    const [source, global] = await Promise.all([this.getSource(), this.getGlobalWallet()]);
    return { source, globalBalance: Number(global.balance) };
  }

  // Розподіл USDT: amount>0 — з глобального у точку; amount<0 — з точки в глобальний.
  async distribute(exchangePointId: number, amount: number) {
    const amt = Number(amount);
    if (!amt) throw new BadRequestException('Сума розподілу має бути ненульовою');
    const g = await this.getGlobalWallet();
    const wallet = await this.getWallet(exchangePointId);
    const gBal = Number(g.balance);
    const pBal = Number(wallet.balance);

    if (amt > 0 && gBal < amt)
      throw new BadRequestException(`Недостатньо USDT у глобальному банку: є ${gBal.toFixed(4)}`);
    if (amt < 0 && pBal < -amt)
      throw new BadRequestException(`Недостатньо USDT у точці: є ${pBal.toFixed(4)}`);

    await this.prisma.$transaction([
      this.prisma.usdtGlobalWallet.update({ where: { id: 1 }, data: { balance: gBal - amt } }),
      this.prisma.usdtWallet.update({ where: { exchangePointId }, data: { balance: pBal + amt } }),
    ]);
    return { globalBalance: gBal - amt, pointBalance: pBal + amt };
  }

  private async generateNumber() {
    const date = format(new Date(), 'yyyyMMdd');
    const count = await this.prisma.usdtOperation.count();
    return `USDT-${date}-${String(count + 1).padStart(4, '0')}`;
  }

  // Курси точки як мапа currency → { buy, sell, mid }. UAH = 1.
  private async pointRates(exchangePointId: number) {
    const rates = await this.prisma.rate.findMany({
      where: { exchangePointId, status: 'ACTIVE' },
    });
    const map: Record<string, { buy: number; sell: number; mid: number }> = {
      UAH: { buy: 1, sell: 1, mid: 1 },
    };
    for (const r of rates) {
      const buy = Number(r.buy);
      const sell = Number(r.sell);
      map[r.currency] = { buy, sell, mid: (buy + sell) / 2 };
    }
    return map;
  }

  // Касир створює USDT-операцію на відкритій зміні своєї каси.
  async create(
    dto: {
      shiftId: number;
      side: Side;
      usdtAmount: number;
      settleCurrency: string;
      settleAmount?: number; // необовʼязкове ручне коригування підсумкової суми
      pct?: number;          // необовʼязковий % на цю операцію (інакше — з гаманця)
      note?: string;
    },
    userId: number,
  ) {
    const side: Side = dto.side === 'BUY' ? 'BUY' : 'SELL';
    const usdtAmount = Number(dto.usdtAmount);
    const settleCurrency = dto.settleCurrency;
    if (!settleCurrency) throw new BadRequestException('Не вказано валюту розрахунку');
    if (!(usdtAmount > 0)) throw new BadRequestException('Сума USDT має бути більшою за 0');

    const shift = await this.prisma.shift.findUnique({
      where: { id: dto.shiftId },
      include: {
        operations: true,
        cashMovements: true,
        usdtOperations: true,
        cashDesk: true,
      },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status !== 'OPEN')
      throw new BadRequestException('USDT-операція можлива лише при відкритій зміні');

    const pointId = shift.cashDesk.exchangePointId;
    const wallet = await this.getWallet(pointId);
    const rates = await this.pointRates(pointId);

    // % — індивідуальний на операцію (якщо переданий), інакше з гаманця точки.
    // Відʼємні відсотки дозволені.
    const defaultPct = side === 'SELL' ? Number(wallet.sellPct) : Number(wallet.buyPct);
    const pct = dto.pct != null && !Number.isNaN(Number(dto.pct)) ? Number(dto.pct) : defaultPct;
    const frac = pct / 100;
    // 1:1 до USD × (1 ± %): продаж дорожче для клієнта, купівля дешевше.
    const usdValue = side === 'SELL' ? usdtAmount * (1 + frac) : usdtAmount * (1 - frac);

    const usd = rates.USD ?? { buy: 0, sell: 0, mid: 0 };
    const tgt = rates[settleCurrency];

    // Підказка суми розрахунку у фізичній валюті (варіант A — за курсом точки).
    let suggested: number;
    if (settleCurrency === 'USD') {
      suggested = usdValue; // 1:1, без курсу
    } else if (!tgt) {
      suggested = 0; // немає курсу — касир вводить вручну
    } else if (side === 'SELL') {
      // Клієнт платить settleCurrency: USD за курсом продажу, валюту купуємо (buy).
      suggested = tgt.buy > 0 ? (usdValue * usd.sell) / tgt.buy : 0;
    } else {
      // Каса видає settleCurrency: USD за курсом купівлі, валюту продаємо (sell).
      suggested = tgt.sell > 0 ? (usdValue * usd.buy) / tgt.sell : 0;
    }

    const settleAmount =
      dto.settleAmount != null ? Number(dto.settleAmount) : round2(suggested);
    if (!(settleAmount > 0))
      throw new BadRequestException('Не вдалося визначити суму розрахунку — вкажіть її вручну');
    const settleRate = usdValue !== 0 ? settleAmount / usdValue : 0;

    // Чиста маржа (%) у гривні: usdtAmount × % × серединний курс USD.
    const profitUah = round2(usdtAmount * frac * usd.mid);

    // Джерело USDT: гаманець точки чи глобальний банк (налаштування).
    const source = await this.getSource();
    const global = source === 'GLOBAL' ? await this.getGlobalWallet() : null;
    const sourceBalance = source === 'GLOBAL' ? Number(global!.balance) : Number(wallet.balance);

    if (side === 'SELL') {
      // Продаємо USDT з гаманця-джерела — має вистачати USDT.
      if (sourceBalance < usdtAmount) {
        const where = source === 'GLOBAL' ? 'глобальному банку' : 'гаманці точки';
        throw new BadRequestException(
          `Недостатньо USDT у ${where}: є ${sourceBalance.toFixed(4)}, продаєте ${usdtAmount.toFixed(4)}`,
        );
      }
    } else {
      // Купуємо USDT — видаємо фізичну готівку, має вистачати settleCurrency у касі.
      const start = shift.startBalance as Record<string, number>;
      const afterOps = applyOperationsToBalance(start, shift.operations);
      const afterMoves = applyCashMovements(afterOps, shift.cashMovements);
      const usdtDelta = usdtCashDelta(shift.usdtOperations as any);
      const available =
        (afterMoves[settleCurrency] ?? 0) + (usdtDelta[settleCurrency] ?? 0);
      if (available < settleAmount) {
        throw new BadRequestException(
          `Недостатньо ${settleCurrency} у касі: є ${available.toFixed(2)}, видаєте ${settleAmount.toFixed(2)}`,
        );
      }
    }

    const number = await this.generateNumber();
    const walletDelta = side === 'SELL' ? -usdtAmount : usdtAmount;

    // Рухаємо саме той гаманець, який обрано джерелом.
    const walletMove =
      source === 'GLOBAL'
        ? this.prisma.usdtGlobalWallet.update({
            where: { id: 1 },
            data: { balance: Number(global!.balance) + walletDelta },
          })
        : this.prisma.usdtWallet.update({
            where: { exchangePointId: pointId },
            data: { balance: Number(wallet.balance) + walletDelta },
          });

    const [op] = await this.prisma.$transaction([
      this.prisma.usdtOperation.create({
        data: {
          number,
          side,
          walletSource: source,
          usdtAmount,
          pct,
          usdValue,
          settleCurrency,
          settleAmount,
          settleRate,
          profitUah,
          note: dto.note,
          shiftId: shift.id,
          cashDeskId: shift.cashDeskId,
          createdById: userId,
        },
        include: { createdBy: { select: { name: true } } },
      }),
      walletMove,
    ]);

    return op;
  }

  async getForShift(shiftId: number) {
    return this.prisma.usdtOperation.findMany({
      where: { shiftId },
      include: { createdBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Історія USDT-операцій (адмінка), опційно по точці/касі/стороні.
  async getAll(filters: { exchangePointId?: number; cashDeskId?: number; side?: Side }) {
    return this.prisma.usdtOperation.findMany({
      where: {
        ...(filters.cashDeskId ? { cashDeskId: filters.cashDeskId } : {}),
        ...(filters.side ? { side: filters.side } : {}),
        ...(filters.exchangePointId
          ? { cashDesk: { exchangePointId: filters.exchangePointId } }
          : {}),
      },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        createdBy: { select: { name: true } },
        shift: { select: { number: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
