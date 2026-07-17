import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { format } from 'date-fns';
import { applyOperationsToBalance, operationsDelta } from '../common/balance.util';
import { sellRates, valueOf } from '../common/profit.util';
import { cashMovementsDelta } from '../common/cash-movements.util';
import { usdtCashDelta, usdtProfit, usdtProfitUsd } from '../common/usdt.util';
import { tillUsdValue, costToUahBasis, NUMERAIRE } from '../common/wac-profit.util';
import { shiftCashBalance, confirmedTransfersNetForDesk } from '../common/shift-ledger.util';
import { nextDocNumber } from '../common/number-seq.util';

import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfitService } from '../profit/profit.service';

// Дати у скачуваному звіті — київський час із явним зсувом (напр.
// "2026-07-16T12:33:44+03:00"), щоб збігалися з тим, що бачать касири в UI.
const REPORT_TZ = 'Europe/Kyiv';
function toKyivIso(d: Date): string {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: REPORT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(d); // "2026-07-16 12:33:44"
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: REPORT_TZ, timeZoneName: 'longOffset' })
    .formatToParts(d)
    .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'; // "GMT+03:00"
  return local.replace(' ', 'T') + offset.replace('GMT', '');
}
// Рекурсивно замінює Date на київський час; заходить лише в масиви та прості
// об'єкти (Decimal тощо не чіпає).
function reportDatesToKyiv(value: unknown): unknown {
  if (value instanceof Date) return toKyivIso(value);
  if (Array.isArray(value)) return value.map(reportDatesToKyiv);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reportDatesToKyiv(v)]));
  }
  return value;
}

@Injectable()
export class ShiftsService {
  constructor(
    private prisma: PrismaService,
    private profit: ProfitService,
    // optional: юніт-тести створюють сервіс без телеграма/сповіщень
    private telegram?: TelegramService,
    private notifications?: NotificationsService,
  ) {}

  private async generateNumber(pointCode: string) {
    const date = format(new Date(), 'yyyyMMdd');
    // Глобальна sequence (раніше — count по точці, що гонило дублікати номерів).
    const seq = await nextDocNumber(this.prisma, 'shift_number_seq');
    return `${pointCode}-${date}-${String(seq).padStart(2, '0')}`;
  }

  async openShift(
    cashDeskId: number,
    userId: number,
    startBalance: object,
    // Початкова собівартість (сер. курс) валют — застосовується лише там, де
    // собівартості ще нема (перша зміна / після скидання). Опційне.
    costBasis?: Record<string, number>,
  ) {
    const existing = await this.prisma.shift.findFirst({
      where: { cashDeskId, status: 'OPEN' },
    });
    if (existing) throw new BadRequestException('Зміна вже відкрита на цій касі');

    const desk = await this.prisma.cashDesk.findUnique({
      where: { id: cashDeskId },
      include: { exchangePoint: true },
    });
    if (!desk) throw new NotFoundException('Каса не знайдена');

    const number = await this.generateNumber(desk.exchangePoint.code);

    try {
      const created = await this.prisma.shift.create({
        data: {
          number,
          cashDeskId,
          openedById: userId,
          startBalance,
        },
        include: { cashDesk: { include: { exchangePoint: true } }, openedBy: true },
      });
      // Початкова собівартість валют (сер. курс) із форми відкриття. Поле
      // дефолтиться поточною собівартістю, тож зазвичай no-op; правку застосовуємо.
      if (costBasis) await this.profit.setBasis(cashDeskId, costBasis);
      // Сповіщення в Telegram (fire-and-forget; без токена — просто лог-скіп)
      void this.telegram?.notifyShiftOpened(
        created.number,
        created.openedBy?.name ?? '',
        created.cashDesk?.exchangePoint?.name ?? '',
      );
      return created;
    } catch (e: any) {
      // Unique-індекс Shift_desk_open_key: гонка подвійного відкриття (подвійний клік).
      if (e?.code === 'P2002')
        throw new BadRequestException('Зміна вже відкрита на цій касі');
      throw e;
    }
  }

  async closeShift(
    shiftId: number,
    endBalance?: object,
    // Хто закриває: касир може закрити лише СВОЮ зміну; адмін/старший — будь-яку.
    actor?: { sub: number; role: string },
  ) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        operations: true,
        cashMovements: true,
        usdtOperations: true,
        cashDesk: true,
        openedBy: { select: { name: true } },
      },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна вже закрита');
    if (actor && actor.role !== 'ADMIN' && shift.openedById !== actor.sub)
      throw new BadRequestException('Закрити можна лише власну зміну');

    // Непідтверджена передача = гроші фізично вже пішли з каси, але в ledger не
    // потрапили (він рахує лише CONFIRMED). Закриття в такому стані давало б
    // фантомну нестачу у відправника і надлишок на наступній зміні.
    const pending = await this.prisma.transfer.findMany({
      where: { status: 'PENDING', fromDeskId: shift.cashDeskId },
      select: { number: true, currency: true, amount: true },
    });
    if (pending.length) {
      const list = pending
        .map((t) => `${t.number} (${Number(t.amount).toFixed(2)} ${t.currency})`)
        .join(', ');
      throw new BadRequestException(
        `Є непідтверджені передачі: ${list}. Дочекайтесь підтвердження отримувачем або скасуйте їх — інакше закриття покаже хибну нестачу.`,
      );
    }

    const start = shift.startBalance as Record<string, number>;

    // Залишок до руху готівки (лише початок + операції) — база для прибутку.
    const opsBalance = applyOperationsToBalance(start, shift.operations);

    // Підкріплення/інкасації змінюють готівку каси, але це не торговий результат.
    const moveDelta = cashMovementsDelta(shift.cashMovements ?? []);

    // USDT-операції рухають фізичну готівку каси (settleCurrency) — це торгова
    // готівка (входить у прибуток окремою маржею), на відміну від руху готівки.
    const usdtDelta = usdtCashDelta((shift.usdtOperations as any) ?? []);

    // Прибуток за $-числовником («каса в доларах»): гривня — позиція з сер.
    // курсом, прибуток реалізується при відкупі; собівартість ПЕРЕНОСИТЬСЯ між
    // змінами. Непроданий запас не переоцінюється.
    const rates = await this.prisma.rate.findMany({
      where: { exchangePointId: shift.cashDesk.exchangePointId, status: 'ACTIVE' },
    });
    // Курси ПРОДАЖУ — лише для оцінки нестачі/надлишку каси (не для прибутку):
    // нестача коштує стільки, за скільки касир продав би цю валюту клієнту.
    const valuation = sellRates(
      rates.map((r) => ({ currency: r.currency, buy: Number(r.buy), sell: Number(r.sell) })),
    );
    // Курс продажу USD на закритті — знімок для конвертацій $↔₴ у звіті.
    const usdRow = rates.find((r) => r.currency === NUMERAIRE);
    const sClose = usdRow ? Number(usdRow.sell) : 0;
    const wac = await this.profit.computeShift({
      cashDeskId: shift.cashDeskId,
      exchangePointId: shift.cashDesk.exchangePointId,
      startBalance: start,
      operations: shift.operations as any,
      // Підкріплення/інкасації та передачі теж рухають позицію (без прибутку) —
      // інакше продаж підкріпленої валюти давав би 0 і псував собівартість.
      cashMovements: (shift.cashMovements ?? []) as any,
      // Готівкові розрахунки USDT-вікна рухають гривню/валюту каси (флоу).
      usdtOperations: (shift.usdtOperations as any) ?? [],
      openedAt: shift.openedAt,
      closedAt: null, // зміна ще відкрита — беремо всі підтверджені передачі
    });
    // Прибуток USDT — чиста маржа (%) з факту проти 1:1, окремим рядком «USDT».
    const usdtUah = usdtProfit((shift.usdtOperations as any) ?? []);
    const usdtUsd = usdtProfitUsd((shift.usdtOperations as any) ?? []);
    // $-нативні підсумки + гривневі знімки (за курсом моменту кожної операції).
    const profitUsd = wac.totalRealized + usdtUsd;
    const perOpUah = wac.perOp.map((p, i) => p * wac.sUsdPerOp[i]);
    const profit = perOpUah.reduce((s, v) => s + v, 0) + usdtUah;
    const profitByCurrencyUsd: Record<string, number> = { ...wac.byCurrency };
    if (Math.abs(usdtUsd) >= 0.005) profitByCurrencyUsd.USDT = usdtUsd;
    const profitByCurrency: Record<string, number> = {};
    wac.ops.forEach((o: any, i: number) => {
      if (Math.abs(perOpUah[i]) < 0.005) return;
      profitByCurrency[o.currency] = (profitByCurrency[o.currency] ?? 0) + perOpUah[i];
    });
    if (Math.abs(usdtUah) >= 0.005) profitByCurrency.USDT = usdtUah;

    // Передачі між касами/точками — це рух готівки, а не торговий прибуток.
    // Вилучаємо їх із фактичного залишку, щоб отримана/відправлена валюта не
    // спотворювала фактичний результат зміни.
    const net = await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt);

    // Розрахунковий (очікуваний фізичний) залишок — єдиний ledger-розрахунок:
    // операції + USDT-готівка + рух готівки + підтверджені передачі/свопи (Б1).
    const calcBalance = shiftCashBalance(
      {
        startBalance: start,
        operations: shift.operations,
        cashMovements: shift.cashMovements ?? [],
        usdtOperations: (shift.usdtOperations as any) ?? [],
      },
      net,
    );

    // Фактичний результат (з нестачею/надлишком касира) — за введеним залишком,
    // з якого вилучаємо нетто-передачі та рух готівки (підкріплення/інкасації):
    // жодне з них не належить до прибутку каси.
    const factualEnd: Record<string, number> = {
      ...((endBalance as Record<string, number>) ?? calcBalance),
    };
    for (const [cur, amt] of Object.entries(net)) {
      factualEnd[cur] = (factualEnd[cur] ?? 0) - amt;
    }
    for (const [cur, d] of Object.entries(moveDelta)) {
      factualEnd[cur] = (factualEnd[cur] ?? 0) - d; // IN(+)→прибираємо, OUT(−)→повертаємо
    }
    // Очікувана торгова готівка = операції + USDT-готівка (рух готівки/передачі
    // не входять — їх вилучено з factualEnd вище). Порівнюємо з фактично введеним.
    const expectedTrading: Record<string, number> = { ...opsBalance };
    for (const [cur, d] of Object.entries(usdtDelta)) {
      expectedTrading[cur] = (expectedTrading[cur] ?? 0) + d;
    }
    // Фактичний результат = прибуток (реалізований + маржа USDT) + нестача/
    // надлишок каси (різниця між фактично введеним і очікуваним залишком за
    // курсами продажу). У ₴ — напряму; у $ — через курс продажу USD на закритті.
    const surplusShort = valueOf(factualEnd, valuation) - valueOf(expectedTrading, valuation);
    const factualProfit = profit + surplusShort;
    const factualProfitUsd = profitUsd + (sClose > 0 ? surplusShort / sClose : 0);

    // Собівартість на закриття — людський формат (UAH ₴/$, інші — $-крос).
    const costBasisSnapshot = Object.fromEntries(
      Object.entries(wac.ending)
        .filter(([cur, p]) => cur !== NUMERAIRE && cur !== 'USDT' && p.avgCost > 0)
        .map(([cur, p]) => [cur, cur === 'UAH' ? costToUahBasis(p.avgCost) : p.avgCost]),
    );
    // «Каса в доларах» за принципом власника — від фактично введеного залишку.
    // USDT — глобальний банк, не готівка каси, тож у підсумок каси не входить.
    const till = tillUsdValue(
      (endBalance as Record<string, number>) ?? calcBalance,
      costBasisSnapshot as Record<string, number>,
    );

    const updated = await this.prisma.shift.update({
      where: { id: shiftId },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        endBalance,
        calcBalance,
        profit,
        profitUsd,
        // Звіт закриття зберігаємо: історія не залежить від подальших курсів.
        factualProfit,
        factualProfitUsd,
        profitByCurrency,
        profitByCurrencyUsd,
        valuationRates: valuation,
        usdSellAtClose: sClose || null,
        tillUsd: { byCurrency: till.byCurrency, total: till.total, usdSellRate: sClose, usdtIncluded: false },
        costBasis: costBasisSnapshot,
      },
    });
    // Переносимо собівартість на наступну зміну цієї каси + записуємо
    // реалізований прибуток кожної операції (фінанси/живий підрахунок).
    await this.profit.saveBasis(shift.cashDeskId, wac.ending);
    const opUpdates = wac.ops
      .map((o: any, i: number) =>
        o.id != null ? { id: o.id, profitUsd: wac.perOp[i], profit: perOpUah[i] } : null,
      )
      .filter((x): x is { id: number; profitUsd: number; profit: number } => x != null);
    if (opUpdates.length) {
      await this.prisma.$transaction(
        opUpdates.map((u) =>
          this.prisma.operation.update({
            where: { id: u.id },
            data: { profitUsd: u.profitUsd, profit: u.profit },
          }),
        ),
      );
    }

    // Сповіщення в Telegram + центр сповіщень адміна (fire-and-forget)
    const who = (shift as any).openedBy?.name ?? '';
    void this.telegram?.notifyShiftClosed(shift.number, who, profit, factualProfit);
    void this.notifications?.notifyAdmins(
      `Зміну №${shift.number} закрито (${who}). Прибуток: ${factualProfitUsd.toFixed(2)} $ (${factualProfit.toFixed(2)} ₴)`,
    );

    return {
      ...updated,
      netTransfers: net,
      netCashMovements: moveDelta,
      netUsdt: usdtDelta,
      usdtProfit: usdtUah,
      usdtProfitUsd: usdtUsd,
    };
  }

  // Залишок із закриття останньої зміни цієї каси — для префілу при відкритті нової.
  // costBasis — поточна перенесена собівартість каси (дефолт поля «сер. курс»).
  async getLastEndBalance(cashDeskId: number) {
    const last = await this.prisma.shift.findFirst({
      where: { cashDeskId, status: 'CLOSED' },
      orderBy: { closedAt: 'desc' },
      select: { number: true, closedAt: true, endBalance: true },
    });
    return {
      endBalance: (last?.endBalance as Record<string, number>) ?? {},
      from: last ? { number: last.number, closedAt: last.closedAt } : null,
      costBasis: await this.profit.getBasis(cashDeskId),
    };
  }

  /**
   * Оновити середню собівартість (сер. курс) валют ВІДКРИТОЇ зміни й одразу
   * перерахувати прибуток операцій. Використовується редагованим полем «сер.
   * курс» у формі закриття. Для закритих змін заборонено (собівартість там
   * переносилась на наступні зміни — правка заднім числом потребувала б каскаду).
   */
  async updateCostBasis(
    shiftId: number,
    costBasis: Record<string, number>,
    actor?: { sub: number; role: string },
  ) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      select: { id: true, status: true, cashDeskId: true, openedById: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED')
      throw new BadRequestException('Собівартість закритої зміни редагувати не можна');
    if (actor && actor.role !== 'ADMIN' && shift.openedById !== actor.sub)
      throw new BadRequestException('Редагувати можна лише власну зміну');
    await this.profit.setBasis(shift.cashDeskId, costBasis);
    await this.profit.recomputeShiftOps(shiftId);
    return { ok: true, costBasis: await this.profit.getBasis(shift.cashDeskId) };
  }

  /**
   * Підтверджені передачі/свопи каси за час життя зміни (Б1/Б2).
   * Для ЗАКРИТОЇ зміни обовʼязково обмежуємо моментом закриття: інакше передачі,
   * підтверджені вже на наступній зміні тієї ж каси, «протікали» б у звіт
   * закритої (вони мають confirmedAt >= її openedAt) і псували її баланс.
   */
  private async confirmedTransfersForShift(
    shift: { cashDeskId: number; openedAt: Date; closedAt?: Date | null } | null,
  ) {
    if (!shift) return [];
    return this.prisma.transfer.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: shift.closedAt
          ? { gte: shift.openedAt, lte: shift.closedAt }
          : { gte: shift.openedAt },
        OR: [{ fromDeskId: shift.cashDeskId }, { toDeskId: shift.cashDeskId }],
      },
      select: {
        id: true, number: true, currency: true, amount: true,
        fromDeskId: true, toDeskId: true,
        counterCurrency: true, counterAmount: true, confirmedAt: true,
      },
      orderBy: { confirmedAt: 'desc' },
    });
  }

  private readonly activeShiftInclude = {
    cashDesk: { include: { exchangePoint: true } },
    openedBy: true,
    operations: { orderBy: { createdAt: 'desc' as const } },
    cashMovements: { orderBy: { createdAt: 'desc' as const } },
    usdtOperations: { orderBy: { createdAt: 'desc' as const } },
  };

  async getActiveShift(cashDeskId: number) {
    const shift = await this.prisma.shift.findFirst({
      where: { cashDeskId, status: 'OPEN' },
      include: this.activeShiftInclude,
    });
    if (!shift) return shift;
    return {
      ...shift,
      confirmedTransfers: await this.confirmedTransfersForShift(shift),
      // Поточна собівартість каси — середній курс, проти якого рахується прибуток.
      costBasisLive: await this.profit.getBasis(cashDeskId),
    };
  }

  async getShiftById(id: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        ...this.activeShiftInclude,
        reconciliations: {
          include: { createdBy: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!shift) return shift;
    return {
      ...shift,
      confirmedTransfers: await this.confirmedTransfersForShift(shift),
      // Для відкритої — поточна собівартість каси; для закритої — збережена (shift.costBasis).
      costBasisLive: shift.status === 'OPEN' ? await this.profit.getBasis(shift.cashDeskId) : undefined,
    };
  }

  /**
   * Повний звіт по зміні (для адмінки, кнопка «Скачати звіт»): усі сирі дані
   * (операції з історією редагувань, рух готівки, USDT, передачі, звірки) +
   * розраховані блоки (оборот, ledger-дельти, розбіжність, собівартість WAC).
   * Призначення — вивантаження повного набору даних зміни для аналізу.
   */
  async getShiftReport(id: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: { select: { id: true, name: true } },
        operations: {
          orderBy: { createdAt: 'asc' },
          include: {
            cashier: { select: { id: true, name: true } },
            edits: {
              orderBy: { editedAt: 'asc' },
              include: { editedBy: { select: { id: true, name: true } } },
            },
          },
        },
        cashMovements: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
        usdtOperations: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
        reconciliations: {
          orderBy: { createdAt: 'asc' },
          include: { createdBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');

    // Підтверджені передачі каси за час життя зміни (для закритої — до closedAt,
    // інакше в звіт потраплять передачі наступної зміни тієї ж каси).
    const transfers = await this.prisma.transfer.findMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: shift.closedAt
          ? { gte: shift.openedAt, lte: shift.closedAt }
          : { gte: shift.openedAt },
        OR: [{ fromDeskId: shift.cashDeskId }, { toDeskId: shift.cashDeskId }],
      },
      orderBy: { confirmedAt: 'asc' },
      include: {
        fromDesk: { select: { id: true, name: true } },
        toDesk: { select: { id: true, name: true } },
        sentBy: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
      },
    });

    // Оборот по валютах: куплено/продано (к-сть, грн, середній курс) — як у деталях зміни.
    const turnover: Record<string, { boughtQty: number; boughtUah: number; soldQty: number; soldUah: number }> = {};
    const ensure = (c: string) => (turnover[c] ??= { boughtQty: 0, boughtUah: 0, soldQty: 0, soldUah: 0 });
    for (const op of shift.operations) {
      if (op.cancelled) continue;
      const amount = Number(op.amount);
      const totalUah = Number(op.totalUah);
      const payCur = op.payCurrency;
      const payAmount = op.payAmount != null ? Number(op.payAmount) : 0;
      if (payCur && payCur !== 'UAH' && op.currency !== 'UAH') {
        const b = ensure(payCur); b.boughtQty += payAmount; b.boughtUah += totalUah;
        const s = ensure(op.currency); s.soldQty += amount; s.soldUah += totalUah;
      } else if (payCur && payCur !== 'UAH') {
        const b = ensure(payCur); b.boughtQty += payAmount; b.boughtUah += totalUah;
      } else if (op.type === 'BUY') {
        const b = ensure(op.currency); b.boughtQty += amount; b.boughtUah += totalUah;
      } else {
        const s = ensure(op.currency); s.soldQty += amount; s.soldUah += totalUah;
      }
    }
    const turnoverRows = Object.entries(turnover)
      .map(([currency, t]) => ({
        currency, ...t,
        avgBuyRate: t.boughtQty > 0 ? t.boughtUah / t.boughtQty : null,
        avgSellRate: t.soldQty > 0 ? t.soldUah / t.soldQty : null,
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency));

    // Ledger-дельти по складових + повний розрахунковий залишок.
    const transfersNet = await confirmedTransfersNetForDesk(
      this.prisma, shift.cashDeskId, shift.openedAt, shift.closedAt,
    );
    const opsDelta = operationsDelta(shift.operations);
    const movesDelta = cashMovementsDelta(shift.cashMovements);
    const usdtDelta = usdtCashDelta(shift.usdtOperations as any);
    const calcBalanceLive = shiftCashBalance(
      {
        startBalance: shift.startBalance as Record<string, number>,
        operations: shift.operations,
        cashMovements: shift.cashMovements,
        usdtOperations: shift.usdtOperations as any,
      },
      transfersNet,
    );

    // Розбіжність факт/розрахунок по валютах (лише для закритих).
    let discrepancy: Record<string, number> | null = null;
    if (shift.status === 'CLOSED') {
      const calc = shift.calcBalance as Record<string, number>;
      const end = shift.endBalance as Record<string, number>;
      discrepancy = {};
      for (const cur of new Set([...Object.keys(calc ?? {}), ...Object.keys(end ?? {})])) {
        const d = Number(end?.[cur] ?? 0) - Number(calc?.[cur] ?? 0);
        if (Math.abs(d) >= 0.005) discrepancy[cur] = d;
      }
    }

    // Контекст моделі: перехідна собівартість ($-числовник: UAH — сер. курс
    // ₴/$, інші — $-крос) і активні курси точки.
    const [costBasis, activeRates] = await Promise.all([
      this.profit.getBasis(shift.cashDeskId),
      this.prisma.rate.findMany({
        where: { exchangePointId: shift.cashDesk.exchangePointId, status: 'ACTIVE' },
        select: { currency: true, buy: true, sell: true, updatedAt: true },
      }),
    ]);

    const { operations, cashMovements, usdtOperations, reconciliations, ...shiftMeta } = shift;
    return reportDatesToKyiv({
      reportVersion: 2, // v2: $-числовник (profitUsd/tillUsd/usdSellAtClose), без buyback
      generatedAt: new Date(),
      shift: shiftMeta,
      operations,
      cashMovements,
      usdtOperations,
      transfers,
      reconciliations,
      turnover: turnoverRows,
      ledger: {
        startBalance: shift.startBalance,
        operationsDelta: opsDelta,
        cashMovementsDelta: movesDelta,
        usdtCashDelta: usdtDelta,
        transfersNet,
        calcBalanceLive,
      },
      discrepancy,
      usdtSummary: {
        margin: usdtProfit(shift.usdtOperations as any),
        marginUsd: usdtProfitUsd(shift.usdtOperations as any),
        cashDelta: usdtDelta,
      },
      wacCostBasis: costBasis,
      activeRates,
    });
  }

  // Список змін (для адмінки) — фільтр по точці/касі, найновіші перші.
  async listShifts(pointId?: number, deskId?: number) {
    return this.prisma.shift.findMany({
      where: {
        ...(deskId ? { cashDeskId: deskId } : {}),
        ...(pointId ? { cashDesk: { exchangePointId: pointId } } : {}),
      },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: { select: { name: true } },
        _count: { select: { operations: true, cashMovements: true, reconciliations: true, usdtOperations: true } },
      },
      orderBy: { openedAt: 'desc' },
      take: 300,
    });
  }

  async getMyActiveShift(userId: number) {
    const shift = await this.prisma.shift.findFirst({
      where: { openedById: userId, status: 'OPEN' },
      include: this.activeShiftInclude,
    });
    if (!shift) return shift;
    return {
      ...shift,
      confirmedTransfers: await this.confirmedTransfersForShift(shift),
      costBasisLive: await this.profit.getBasis(shift.cashDeskId),
    };
  }

  async adjustBalance(shiftId: number, newCurrentBalance: Record<string, number>) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: { operations: true, cashMovements: true, usdtOperations: true },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна закрита');

    // Поточний залишок — єдиний ledger-розрахунок (операції + рух готівки +
    // USDT-готівка + передачі). Дельта = ledger із нульовим стартом, тож
    // newStartBalance[cur] = newCurrentBalance[cur] − delta[cur].
    // (Раніше USDT/передачі не враховувались — коригування псувало startBalance.)
    const delta = shiftCashBalance(
      {
        startBalance: {},
        operations: shift.operations,
        cashMovements: shift.cashMovements ?? [],
        usdtOperations: (shift.usdtOperations as any) ?? [],
      },
      await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt),
    );

    const startBalance = shift.startBalance as Record<string, number>;
    const newStartBalance: Record<string, number> = { ...startBalance };
    for (const [cur, newAmt] of Object.entries(newCurrentBalance)) {
      newStartBalance[cur] = newAmt - (delta[cur] ?? 0);
    }

    const updated = await this.prisma.shift.update({
      where: { id: shiftId },
      data: { startBalance: newStartBalance },
    });
    // startBalance — це відкриваюча позиція WAC, тож прибуток операцій треба
    // перерахувати одразу (інакше фінанси до закриття зміни показують старі числа).
    await this.profit.recomputeShiftOps(shiftId);
    return updated;
  }

  async getAllActiveShifts() {
    return this.prisma.shift.findMany({
      where: { status: 'OPEN' },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        openedBy: true,
        _count: { select: { operations: true } },
      },
    });
  }
}
