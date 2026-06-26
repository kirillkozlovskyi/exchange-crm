import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { format } from 'date-fns';
import { computeOperationTotals, RateLookup } from './operations.math';

@Injectable()
export class OperationsService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  private async generateNumber(pointCode: string) {
    const date = format(new Date(), 'yyyyMMdd');
    const count = await this.prisma.operation.count();
    return `${pointCode}-${date}-${String(count + 1).padStart(6, '0')}`;
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
  }, cashierId: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id: dto.shiftId },
      include: { cashDesk: { include: { exchangePoint: true } } },
    });
    if (!shift) throw new NotFoundException('Зміну не знайдено');
    if (shift.status === 'CLOSED') throw new BadRequestException('Зміна закрита');

    const exchangePointId = shift.cashDesk.exchangePointId;

    const getRate = await this.buildRateLookup(exchangePointId, [dto.currency, dto.payCurrency]);
    const { type, totalUah, profit } = computeOperationTotals(dto, getRate);

    const payCur = dto.payCurrency || 'UAH';
    const number = await this.generateNumber(shift.cashDesk.exchangePoint.code);

    return this.prisma.operation.create({
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
      },
    });
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

    const exchangePointId = op.shift.cashDesk.exchangePointId;

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

    // Сторно дозволено тільки якщо операція є ОСТАННЬОЮ ВЗАГАЛІ в зміні
    const overallLastOp = await this.prisma.operation.findFirst({
      where: { shiftId: op.shiftId },
      orderBy: { createdAt: 'desc' },
    });
    if (!overallLastOp || overallLastOp.id !== id)
      throw new BadRequestException('Сторно дозволено тільки для останньої операції зміни');

    // Перевірка часового вікна сторно
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
