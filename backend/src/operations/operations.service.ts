import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { format } from 'date-fns';
import { computeOperationTotals, RateLookup } from './operations.math';
import { nextDocNumber } from '../common/number-seq.util';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class OperationsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private telegram?: TelegramService,
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
      include: { cashDesk: { include: { exchangePoint: true } } },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна закрита');

    // USDT має єдиний шлях — вікно ₮ USDT (віртуальний гаманець + фізична
    // готівка). Другий шлях через основну форму давав подвійний облік.
    if (dto.currency === 'USDT' || dto.payCurrency === 'USDT')
      throw new BadRequestException('USDT торгується лише через вікно ₮ USDT');

    const exchangePointId = shift.cashDesk.exchangePointId;

    const getRate = await this.buildRateLookup(exchangePointId, [dto.currency, dto.payCurrency]);
    const { type, totalUah, profit } = computeOperationTotals(dto, getRate);
    this.assertValidAmounts(dto.amount, dto.rate, totalUah);

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
      }
    })().catch(() => {});

    try {
      return await this.prisma.operation.create({
        data: {
          number,
          type,
          currency: dto.currency,
          amount: dto.amount,
          rate: dto.rate,
          totalUah,
          profit,
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

    // Перераховуємо totalUah та profit тією ж логікою, що й при створенні.
    // mode = op.type зберігає тип (важливо для крос-операцій, збережених як BUY/SELL).
    const getRate = await this.buildRateLookup(exchangePointId, [op.currency, op.payCurrency]);
    const { totalUah, profit } = computeOperationTotals(
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

    return this.prisma.operation.update({
      where: { id },
      data: { amount: dto.amount, rate: dto.rate, totalUah, profit },
    });
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

    return this.prisma.operation.update({
      where: { id },
      data: { cancelled: true, cancelNote: note ?? null },
    });
  }

  async getEdits(operationId: number) {
    return this.prisma.operationEdit.findMany({
      where: { operationId },
      orderBy: { editedAt: 'asc' },
      include: { editedBy: { select: { name: true } } },
    });
  }

  async getAll(type?: 'BUY' | 'SELL' | 'EXCHANGE') {
    return this.prisma.operation.findMany({
      where: type ? { type } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 500, // адмінська стрічка: без ліміту віддавала б усю історію
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
