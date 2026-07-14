import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { format } from 'date-fns';
import { computeOperationTotals, RateLookup } from './operations.math';
import { nextDocNumber } from '../common/number-seq.util';
import { operationsDelta, BalanceOperation } from '../common/balance.util';
import { CashMovementRow } from '../common/cash-movements.util';
import { shiftCashBalance, confirmedTransfersNetForDesk } from '../common/shift-ledger.util';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ProfitService } from '../profit/profit.service';

@Injectable()
export class OperationsService {
  private readonly logger = new Logger(OperationsService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private profit: ProfitService,
    private telegram?: TelegramService,
    private notifications?: NotificationsService,
  ) {}

  /**
   * Захист від «фантомних» записів (як 13:34 «Купівля 13 431 USD = 0 грн»):
   * ненульова кількість валюти за курсом > 0 не може дати 0 грн. Ловить нульову/
   * відʼємну кількість, нульовий курс і крос із payAmount=0 (тоді totalUah=0).
   */
  private assertValidAmounts(amount: number, rate: number, totalUah: number) {
    if (!Number.isFinite(amount) || amount <= 0)
      throw new BadRequestException('Кількість валюти має бути більшою за 0');
    if (!Number.isFinite(rate) || rate <= 0)
      throw new BadRequestException('Курс має бути більшим за 0');
    if (!Number.isFinite(totalUah) || totalUah <= 0)
      throw new BadRequestException(
        'Сума операції в грн вийшла 0 — перевірте кількість, курс і суму до сплати',
      );
  }

  /**
   * Перевірка достатності готівки для операції: беремо ledger-залишок зміни
   * (той самий, що бачить касир) і застосовуємо дельту операції — жодна валюта
   * не має піти в мінус.
   *
   * Офлайн-синк (clientId) НЕ блокуємо: операція фізично вже відбулась у касі,
   * відхилити її при синхронізації означало б втратити реальний документ.
   */
  private async assertEnoughCash(
    shift: {
      cashDeskId: number;
      openedAt: Date;
      startBalance: unknown;
      operations: BalanceOperation[];
      cashMovements: CashMovementRow[];
      usdtOperations: unknown[];
    },
    op: BalanceOperation & { clientId?: string },
  ) {
    if (op.clientId) return; // офлайн-синк: факт, що вже стався

    const balance = shiftCashBalance(
      {
        startBalance: (shift.startBalance as Record<string, number>) ?? {},
        operations: shift.operations,
        cashMovements: shift.cashMovements,
        usdtOperations: shift.usdtOperations as any,
      },
      await confirmedTransfersNetForDesk(this.prisma, shift.cashDeskId, shift.openedAt),
    );

    for (const [cur, delta] of Object.entries(operationsDelta([op]))) {
      if (delta >= 0) continue; // каса приймає цю валюту — перевіряти нічого
      const have = balance[cur] ?? 0;
      const need = -delta;
      if (have + 0.01 < need) {
        throw new BadRequestException(
          `Недостатньо ${cur} у касі: є ${have.toFixed(2)}, потрібно видати ${need.toFixed(2)}`,
        );
      }
    }
  }

  private async generateNumber(pointCode: string) {
    const date = format(new Date(), 'yyyyMMdd');
    const seq = await nextDocNumber(this.prisma, 'operation_number_seq');
    return `${pointCode}-${date}-${String(seq).padStart(6, '0')}`;
  }

  /** Лукап активних курсів точки для валют, що беруть участь в операції. */
  private async buildRateLookup(
    exchangePointId: number,
    currencies: (string | null | undefined)[],
  ): Promise<RateLookup> {
    const unique = [...new Set(currencies.filter((c): c is string => !!c && c !== 'UAH'))];
    const rates = await Promise.all(
      unique.map((currency) =>
        this.prisma.rate.findFirst({
          where: { exchangePointId, currency, status: 'ACTIVE' },
        }),
      ),
    );
    const map = new Map<string, { buy: number; sell: number }>();
    rates.forEach((r, i) => {
      if (r) map.set(unique[i], { buy: Number(r.buy), sell: Number(r.sell) });
    });
    return (currency: string) => map.get(currency) ?? null;
  }

  async create(dto: {
    shiftId: number;
    currency: string;
    amount: number;
    rate: number;
    payCurrency?: string;
    payAmount?: number;
    note?: string;
    // Необовʼязково: прибуток, який касир порахував сам (для звірки логіки),
    // і словесний опис, як саме він його порахував.
    cashierProfit?: number | null;
    cashierProfitNote?: string | null;
    // mode — вкладка касира; для крос визначає BUY/SELL замість EXCHANGE
    mode?: 'BUY' | 'SELL';
    // Офлайн-синк: uuid операції з фронта (ідемпотентність) + реальний час
    // створення в офлайні (приймається ЛИШЕ разом із clientId).
    clientId?: string;
    createdAt?: string;
  }, cashierId: number) {
    // Ідемпотентність: та сама операція, надіслана повторно (ретрай після
    // збою зв'язку), не створює дубля — повертаємо вже збережену.
    if (dto.clientId) {
      const existing = await this.prisma.operation.findUnique({
        where: { clientId: dto.clientId },
      });
      if (existing) return existing;
    }

    const shift = await this.prisma.shift.findUnique({
      where: { id: dto.shiftId },
      include: {
        cashDesk: { include: { exchangePoint: true } },
        operations: true,
        cashMovements: true,
        usdtOperations: true,
      },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна закрита');

    // USDT має єдиний шлях — вікно ₮ USDT (віртуальний гаманець + фізична
    // готівка). Другий шлях через основну форму давав подвійний облік.
    if (dto.currency === 'USDT' || dto.payCurrency === 'USDT')
      throw new BadRequestException('USDT торгується лише через вікно ₮ USDT');

    const exchangePointId = shift.cashDesk.exchangePointId;

    const getRate = await this.buildRateLookup(exchangePointId, [dto.currency, dto.payCurrency]);
    // profit із computeOperationTotals — стара модель «спред на обох плечах» (вона
    // ЗАВЖДИ додатна). Не зберігаємо її: справжній прибуток за WAC проставляє
    // recomputeShiftOps одразу після створення. Якщо перерахунок упаде, у полі
    // лишиться 0 (недооцінка), а не вигаданий плюс.
    const { type, totalUah } = computeOperationTotals(dto, getRate);
    this.assertValidAmounts(dto.amount, dto.rate, totalUah);

    // Каса не може віддати більше, ніж має. Раніше перевірка була ЛИШЕ на фронті:
    // прямий запит (або баг у формі) міг завести касу в мінус, а мінусова позиція
    // ламає й прибуток (WAC починає рахувати «продаж у борг»).
    await this.assertEnoughCash(shift, { ...dto, type, totalUah });

    const payCur = dto.payCurrency || 'UAH';
    const number = await this.generateNumber(shift.cashDesk.exchangePoint.code);

    // Операція понад поріг → Telegram (fire-and-forget; 0 = вимкнено).
    void (async () => {
      const threshold = await this.settings.getLargeOpUah();
      if (threshold > 0 && totalUah >= threshold) {
        const user = await this.prisma.user.findUnique({
          where: { id: cashierId },
          select: { name: true },
        });
        await this.telegram?.notifyLargeOperation(
          shift.cashDesk.exchangePoint.name,
          user?.name ?? '',
          type,
          dto.amount,
          dto.currency,
          totalUah,
        );
        await this.notifications?.notifyAdmins(
          `Велика операція: ${type === 'BUY' ? 'купівля' : type === 'SELL' ? 'продаж' : 'обмін'} ` +
          `${dto.amount} ${dto.currency} = ${totalUah.toFixed(2)} ₴ · ${shift.cashDesk.exchangePoint.name} · ${user?.name ?? ''}`,
        );
      }
    })().catch(() => {});

    let created;
    try {
      created = await this.prisma.operation.create({
        data: {
          number,
          type,
          currency: dto.currency,
          amount: dto.amount,
          rate: dto.rate,
          totalUah,
          profit: 0, // проставить recomputeShiftOps (WAC) одразу нижче
          // Довідкові поля: не впливають на розрахунки, зберігаємо як ввів касир.
          cashierProfit: Number.isFinite(Number(dto.cashierProfit)) ? Number(dto.cashierProfit) : null,
          cashierProfitNote: dto.cashierProfitNote?.trim() || null,
          note: dto.note,
          payCurrency: payCur !== 'UAH' ? payCur : null,
          payAmount: dto.payAmount ?? null,
          shiftId: dto.shiftId,
          cashierId,
          clientId: dto.clientId ?? null,
          // Час з фронта — лише для офлайн-синку (разом із clientId).
          ...(dto.clientId && dto.createdAt ? { createdAt: new Date(dto.createdAt) } : {}),
        },
      });
    } catch (e: any) {
      // Гонка ідемпотентності: два ретраї одночасно — повертаємо збережену.
      if (e?.code === 'P2002' && dto.clientId) {
        const existing = await this.prisma.operation.findUnique({ where: { clientId: dto.clientId } });
        if (existing) return existing;
      }
      throw e;
    }
    // Перераховуємо реалізований прибуток (WAC) по всій зміні — щоб живий
    // підрахунок і фінанси одразу бачили правильні числа.
    await this.recomputeProfit(dto.shiftId);
    return created;
  }

  async getByShift(shiftId: number) {
    return this.prisma.operation.findMany({
      where: { shiftId },
      orderBy: { createdAt: 'desc' },
      include: {
        cashier: { select: { name: true } },
        _count: { select: { edits: true } },
      },
    });
  }

  async getDailyByPoint(exchangePointId: number) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    return this.prisma.operation.findMany({
      where: {
        createdAt: { gte: start },
        shift: { cashDesk: { exchangePointId } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: number,
    dto: { amount: number; rate: number; note?: string },
    editorId: number,
  ) {
    const op = await this.prisma.operation.findUnique({
      where: { id },
      include: {
        shift: {
          include: { cashDesk: { include: { exchangePoint: true } } },
        },
      },
    });
    if (!op) throw new NotFoundException('Операцію не знайдено');
    if (op.shift.status === 'CLOSED')
      throw new BadRequestException('Зміна закрита — редагування неможливе');
    if (op.cancelled)
      throw new BadRequestException('Операцію скасовано (сторно) — редагування неможливе');

    const exchangePointId = op.shift.cashDesk.exchangePointId;

    // Перераховуємо totalUah тією ж логікою, що й при створенні (profit не беремо —
    // це стара, завжди-додатна модель; його проставить recomputeShiftOps за WAC).
    // mode = op.type зберігає тип (важливо для крос-операцій, збережених як BUY/SELL).
    const getRate = await this.buildRateLookup(exchangePointId, [op.currency, op.payCurrency]);
    const { totalUah } = computeOperationTotals(
      {
        currency: op.currency,
        amount: dto.amount,
        rate: dto.rate,
        payCurrency: op.payCurrency,
        payAmount: op.payAmount != null ? Number(op.payAmount) : null,
        mode: op.type,
      },
      getRate,
    );
    // Валідуємо ДО логування, щоб не лишати сирітський OperationEdit при помилці
    this.assertValidAmounts(dto.amount, dto.rate, totalUah);

    // Зберігаємо запис про редагування
    await this.prisma.operationEdit.create({
      data: {
        operationId: id,
        editedById: editorId,
        note: dto.note,
        prevAmount: op.amount,
        prevRate: op.rate,
        newAmount: dto.amount,
        newRate: dto.rate,
      },
    });

    const res = await this.prisma.operation.update({
      where: { id },
      data: { amount: dto.amount, rate: dto.rate, totalUah },
    });
    await this.recomputeProfit(op.shiftId);
    return res;
  }

  async storno(id: number, userId: number, note?: string) {
    const op = await this.prisma.operation.findUnique({
      where: { id },
      include: { shift: true },
    });
    if (!op) throw new NotFoundException('Операцію не знайдено');
    if (op.shift.status === 'CLOSED')
      throw new BadRequestException('Зміна закрита — сторно неможливе');
    if (op.cancelled)
      throw new BadRequestException('Операцію вже скасовано');

    // Сторно дозволено для будь-якої операції в межах часового вікна (не лише
    // останньої) — баланс і прибуток скрізь пропускають cancelled, тож скасування
    // операції з середини зміни перераховується коректно.
    const windowMinutes = await this.settings.getStornoWindowMinutes();
    const ageMs = Date.now() - new Date(op.createdAt).getTime();
    if (ageMs > windowMinutes * 60 * 1000)
      throw new BadRequestException(
        `Сторно можливе лише протягом ${windowMinutes} хв після операції`,
      );

    const res = await this.prisma.operation.update({
      where: { id },
      data: { cancelled: true, cancelNote: note ?? null },
    });
    await this.recomputeProfit(op.shiftId);
    return res;
  }

  /**
   * Перерахунок прибутку зміни (WAC) після створення/редагування/сторно.
   * Помилку НЕ ковтаємо мовчки: сама операція вже збережена й коректна, тож
   * запит не валимо, але збій має бути видно в логах — інакше в op.profit
   * тихо лишиться 0 і фінанси недоотримають прибуток до закриття зміни.
   */
  private async recomputeProfit(shiftId: number) {
    try {
      await this.profit.recomputeShiftOps(shiftId);
    } catch (e) {
      this.logger.error(
        `Не вдалося перерахувати прибуток (WAC) зміни ${shiftId} — profit операцій лишається 0 до закриття зміни`,
        e as any,
      );
    }
  }

  async getEdits(operationId: number) {
    return this.prisma.operationEdit.findMany({
      where: { operationId },
      orderBy: { editedAt: 'asc' },
      include: { editedBy: { select: { name: true } } },
    });
  }

  async getAll(type?: 'BUY' | 'SELL' | 'EXCHANGE', date?: string) {
    // Фільтр за днем (YYYY-MM-DD) — щоб календар діставав і старі дні, а не лише
    // останні 500. Без дати — останні 500 записів.
    let createdAt: { gte: Date; lte: Date } | undefined;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const from = new Date(date + 'T00:00:00');
      const to = new Date(date + 'T23:59:59.999');
      if (!Number.isNaN(from.getTime())) createdAt = { gte: from, lte: to };
    }
    return this.prisma.operation.findMany({
      where: { ...(type ? { type } : {}), ...(createdAt ? { createdAt } : {}) },
      orderBy: { createdAt: 'desc' },
      take: createdAt ? undefined : 500, // за конкретний день — усі; інакше ліміт
      include: {
        cashier: { select: { name: true } },
        shift: {
          include: {
            cashDesk: {
              include: { exchangePoint: { select: { name: true } } },
            },
          },
        },
      },
    });
  }
}
