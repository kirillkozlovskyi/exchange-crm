import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { shiftCashBalance, confirmedTransfersNetForDesk } from '../common/shift-ledger.util';
import { nextDocNumber } from '../common/number-seq.util';
import { SettingsService } from '../settings/settings.service';

type Side = 'BUY' | 'SELL';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class UsdtService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

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
    }));
  }

  // Ручне коригування балансу гаманця (адмін): депозит/зняття USDT.
  // Атомарно: інкремент/умовний декремент (без read-then-write, що губив
  // паралельні оновлення).
  async adjustBalance(exchangePointId: number, delta: number) {
    const d = Number(delta);
    await this.getWallet(exchangePointId); // гарантуємо існування рядка
    if (d >= 0) {
      return this.prisma.usdtWallet.update({
        where: { exchangePointId },
        data: { balance: { increment: d } },
      });
    }
    const res = await this.prisma.usdtWallet.updateMany({
      where: { exchangePointId, balance: { gte: -d } },
      data: { balance: { decrement: -d } },
    });
    if (res.count === 0)
      throw new BadRequestException('Баланс гаманця не може стати відʼємним');
    return this.getWallet(exchangePointId);
  }

  // ── Глобальний гаманець USDT (singleton id=1) ─────────────────────────────
  async getGlobalWallet() {
    return this.prisma.usdtGlobalWallet.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  // Ручне коригування глобального балансу (депозит/зняття USDT). Атомарно.
  async adjustGlobal(delta: number) {
    const d = Number(delta);
    await this.getGlobalWallet(); // гарантуємо існування singleton-рядка
    if (d >= 0) {
      return this.prisma.usdtGlobalWallet.update({
        where: { id: 1 },
        data: { balance: { increment: d } },
      });
    }
    const res = await this.prisma.usdtGlobalWallet.updateMany({
      where: { id: 1, balance: { gte: -d } },
      data: { balance: { decrement: -d } },
    });
    if (res.count === 0)
      throw new BadRequestException('Глобальний баланс не може стати відʼємним');
    return this.getGlobalWallet();
  }

  // Джерело USDT для операцій кас: 'POINT' (гаманець точки) або 'GLOBAL'.
  // Дефолт — GLOBAL: глобальний банк є єдиним джерелом, каси беруть наявність із
  // нього (розподіл по точках прихований у вью). Лишається лише явне 'POINT'.
  async getSource(): Promise<'POINT' | 'GLOBAL'> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'usdt_source' } });
    return s?.value === 'POINT' ? 'POINT' : 'GLOBAL';
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
  // Атомарно: умовний декремент джерела (захист від відʼємного під конкурентністю)
  // + інкремент отримувача в одній транзакції.
  async distribute(exchangePointId: number, amount: number) {
    const amt = Number(amount);
    if (!amt) throw new BadRequestException('Сума розподілу має бути ненульовою');
    // Гарантуємо існування обох рядків до транзакції.
    await Promise.all([this.getGlobalWallet(), this.getWallet(exchangePointId)]);

    await this.prisma.$transaction(async (tx) => {
      if (amt > 0) {
        const res = await tx.usdtGlobalWallet.updateMany({
          where: { id: 1, balance: { gte: amt } },
          data: { balance: { decrement: amt } },
        });
        if (res.count === 0)
          throw new BadRequestException('Недостатньо USDT у глобальному банку');
        await tx.usdtWallet.update({
          where: { exchangePointId },
          data: { balance: { increment: amt } },
        });
      } else {
        const res = await tx.usdtWallet.updateMany({
          where: { exchangePointId, balance: { gte: -amt } },
          data: { balance: { decrement: -amt } },
        });
        if (res.count === 0)
          throw new BadRequestException('Недостатньо USDT у точці');
        await tx.usdtGlobalWallet.update({
          where: { id: 1 },
          data: { balance: { increment: -amt } },
        });
      }
    });

    const [g, wallet] = await Promise.all([this.getGlobalWallet(), this.getWallet(exchangePointId)]);
    return { globalBalance: Number(g.balance), pointBalance: Number(wallet.balance) };
  }

  private async generateNumber() {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = await nextDocNumber(this.prisma, 'usdt_number_seq');
    return `USDT-${date}-${String(seq).padStart(4, '0')}`;
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

    // % — індивідуальний на операцію (дефолт 0; відʼємні дозволені). Це лише
    // калькулятор запропонованої суми — прибуток рахується з ФАКТУ нижче.
    const pct = dto.pct != null && !Number.isNaN(Number(dto.pct)) ? Number(dto.pct) : 0;
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

    // Прибуток — з ФАКТИЧНИХ грошей, а не з поля «%»: фізична сума розрахунку
    // проти бази 1:1. Касир продав 300 USDT за 305 USD (хай і з %=0) → маржа
    // 5 USD; продав рівно 1:1 → 0. Раніше маржа рахувалась із %, і ручні
    // корекції суми не потрапляли у прибуток.
    const settleUsd =
      settleCurrency === 'USD'
        ? settleAmount
        : settleCurrency === 'UAH'
          ? usd.mid > 0 ? settleAmount / usd.mid : NaN
          : tgt && usd.mid > 0 ? (settleAmount * tgt.mid) / usd.mid : NaN;
    const marginUsd = side === 'SELL' ? settleUsd - usdtAmount : usdtAmount - settleUsd;
    // Немає курсу для конвертації — маржу не оцінюємо (0), щоб не вигадувати.
    const profitUah = Number.isFinite(marginUsd) ? round2(marginUsd * usd.mid) : 0;
    // Нативна маржа у $ ($-числовник): та сама величина без конвертації.
    const profitUsd = Number.isFinite(marginUsd) ? round2(marginUsd) : 0;

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
      // Єдиний ledger-розрахунок (з рухом готівки, USDT і передачами).
      const balance = shiftCashBalance(
        {
          startBalance: shift.startBalance as Record<string, number>,
          operations: shift.operations,
          cashMovements: shift.cashMovements,
          usdtOperations: shift.usdtOperations as any,
        },
        await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt),
      );
      const available = balance[settleCurrency] ?? 0;
      if (available < settleAmount) {
        throw new BadRequestException(
          `Недостатньо ${settleCurrency} у касі: є ${available.toFixed(2)}, видаєте ${settleAmount.toFixed(2)}`,
        );
      }
    }

    const number = await this.generateNumber();

    // Рух гаманця-джерела + запис операції — атомарно. SELL — умовний декремент
    // (під конкурентністю баланс не піде в мінус: попередня перевірка вище —
    // лише швидка/дружня, авторитетний захист саме тут), BUY — інкремент.
    return this.prisma.$transaction(async (tx) => {
      if (side === 'SELL') {
        const res =
          source === 'GLOBAL'
            ? await tx.usdtGlobalWallet.updateMany({
                where: { id: 1, balance: { gte: usdtAmount } },
                data: { balance: { decrement: usdtAmount } },
              })
            : await tx.usdtWallet.updateMany({
                where: { exchangePointId: pointId, balance: { gte: usdtAmount } },
                data: { balance: { decrement: usdtAmount } },
              });
        if (res.count === 0) {
          const where = source === 'GLOBAL' ? 'глобальному банку' : 'гаманці точки';
          throw new BadRequestException(`Недостатньо USDT у ${where}`);
        }
      } else if (source === 'GLOBAL') {
        await tx.usdtGlobalWallet.update({
          where: { id: 1 },
          data: { balance: { increment: usdtAmount } },
        });
      } else {
        await tx.usdtWallet.update({
          where: { exchangePointId: pointId },
          data: { balance: { increment: usdtAmount } },
        });
      }

      return tx.usdtOperation.create({
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
          profitUsd,
          note: dto.note,
          shiftId: shift.id,
          cashDeskId: shift.cashDeskId,
          createdById: userId,
        },
        include: { createdBy: { select: { name: true } } },
      });
    });
  }

  // Сторно USDT-операції — та сама логіка, що й у валютних: у межах часового
  // вікна, будь-яка операція зміни (не лише остання). Крім позначки cancelled,
  // ВІДКОЧУЄМО рух віртуального гаманця (він зберігається, а не рахується):
  // SELL повертає USDT у гаманець, BUY — знімає назад.
  async storno(id: number, userId: number, note?: string) {
    const op = await this.prisma.usdtOperation.findUnique({
      where: { id },
      include: { shift: true, cashDesk: true },
    });
    if (!op) throw new NotFoundException('USDT-операцію не знайдено');
    if (op.shift.status === 'CLOSED')
      throw new BadRequestException('Зміна закрита — сторно неможливе');
    if (op.cancelled) throw new BadRequestException('Операцію вже скасовано');

    const windowMinutes = await this.settings.getStornoWindowMinutes();
    const ageMs = Date.now() - new Date(op.createdAt).getTime();
    if (ageMs > windowMinutes * 60 * 1000)
      throw new BadRequestException(
        `Сторно можливе лише протягом ${windowMinutes} хв після операції`,
      );

    const usdtAmount = Number(op.usdtAmount);
    const pointId = op.cashDesk.exchangePointId;

    // Відкат гаманця-джерела + позначка cancelled — атомарно.
    return this.prisma.$transaction(async (tx) => {
      // SELL знімало USDT з гаманця → повертаємо (+); BUY додавало → знімаємо (−).
      const revInc = op.side === 'SELL' ? usdtAmount : -usdtAmount;
      if (op.walletSource === 'GLOBAL') {
        await tx.usdtGlobalWallet.update({ where: { id: 1 }, data: { balance: { increment: revInc } } });
      } else {
        await tx.usdtWallet.update({ where: { exchangePointId: pointId }, data: { balance: { increment: revInc } } });
      }
      return tx.usdtOperation.update({
        where: { id },
        data: { cancelled: true, cancelNote: note ?? null },
      });
    });
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
