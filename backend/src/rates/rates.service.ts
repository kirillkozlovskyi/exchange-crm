import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class RatesService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private telegram: TelegramService,
  ) {}

  async getByPoint(exchangePointId: number) {
    // Повертаємо тільки валюти, які є в активному довіднику Currency
    const activeCurrencies = await this.prisma.currency.findMany({
      where: { active: true },
      select: { code: true },
    });
    const codes = activeCurrencies.map((c) => c.code);

    return this.prisma.rate.findMany({
      where: { exchangePointId, status: 'ACTIVE', currency: { in: codes } },
      orderBy: { currency: 'asc' },
    });
  }

  async upsert(dto: {
    exchangePointId: number;
    currency: string;
    buy: number;
    sell: number;
  }, userId: number) {
    try {
      // Деактивація старого + створення нового — атомарно. Unique-індекс
      // Rate_point_currency_active_key гарантує один ACTIVE на точку+валюту.
      const [, created] = await this.prisma.$transaction([
        this.prisma.rate.updateMany({
          where: { exchangePointId: dto.exchangePointId, currency: dto.currency, status: 'ACTIVE' },
          data: { status: 'INACTIVE' },
        }),
        this.prisma.rate.create({
          data: {
            currency: dto.currency,
            buy: dto.buy,
            sell: dto.sell,
            exchangePointId: dto.exchangePointId,
            proposedById: userId,
            approvedById: userId,
            status: 'ACTIVE',
          },
        }),
      ]);
      // Автопост курсів у канали (якщо увімкнено) — не блокує збереження.
      if (await this.settings.getRateAutopost()) {
        this.publishPoint(dto.exchangePointId).catch(() => {});
      }
      return created;
    } catch (e: any) {
      if (e?.code === 'P2002')
        throw new ConflictException('Курс саме оновлюється іншим користувачем — повторіть');
      throw e;
    }
  }

  /** Публікує актуальні курси точки в усі налаштовані Telegram-канали. */
  async publishPoint(exchangePointId: number): Promise<{ sent: number; total: number }> {
    const point = await this.prisma.exchangePoint.findUnique({ where: { id: exchangePointId } });
    if (!point) throw new NotFoundException('Точку не знайдено');
    const channels = await this.settings.getTelegramChannels();
    if (!channels.length) return { sent: 0, total: 0 };
    const rates = await this.getByPoint(exchangePointId);
    if (!rates.length) return { sent: 0, total: channels.length };
    const message = this.telegram.formatRates(
      point.name,
      rates.map((r) => ({ currency: r.currency, buy: Number(r.buy), sell: Number(r.sell) })),
    );
    return this.telegram.postToChannels(channels, message);
  }

  async getAllActive() {
    return this.prisma.rate.findMany({
      where: { status: 'ACTIVE' },
      include: { exchangePoint: true },
      orderBy: [{ exchangePointId: 'asc' }, { currency: 'asc' }],
    });
  }
}
