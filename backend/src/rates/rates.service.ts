import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { format } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../telegram/telegram.service';
import { renderRateCardPng, RateCardRow, Trend, CardTheme, CURRENCY_NAMES } from '../telegram/rate-card';

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

    // Картинка (макет каналу) або текст — за налаштуванням.
    if (await this.settings.getRatePostAsImage()) {
      const png = await this.renderCard(exchangePointId);
      if (png) return this.telegram.postPhotoToChannels(channels, png);
    }

    const message = this.telegram.formatRates(
      point.name,
      rates.map((r) => ({ currency: r.currency, buy: Number(r.buy), sell: Number(r.sell) })),
    );
    return this.telegram.postToChannels(channels, message);
  }

  /**
   * Картка курсів точки у PNG (для Telegram і прев'ю в адмінці).
   * Стрілка тренду — порівняння курсу ПРОДАЖУ з попереднім (архівним) курсом
   * цієї ж валюти: історія лишається в Rate зі статусом INACTIVE.
   */
  async renderCard(exchangePointId: number, theme?: CardTheme): Promise<Buffer | null> {
    const rates = await this.getByPoint(exchangePointId);
    if (!rates.length) return null;

    const cfg = await this.settings.getRateCardConfig();
    const cardTheme = theme ?? (await this.settings.getRateCardTheme());
    const rows: RateCardRow[] = [];

    for (const r of rates) {
      const prev = await this.prisma.rate.findFirst({
        where: { exchangePointId, currency: r.currency, status: 'INACTIVE' },
        orderBy: { createdAt: 'desc' },
        select: { sell: true },
      });
      const sell = Number(r.sell);
      const prevSell = prev ? Number(prev.sell) : null;
      const trend: Trend =
        prevSell == null || Math.abs(sell - prevSell) < 0.0001
          ? 'flat'
          : sell > prevSell
            ? 'up'
            : 'down';

      rows.push({
        currency: r.currency,
        name: CURRENCY_NAMES[r.currency] ?? r.currency,
        buy: Number(r.buy),
        sell,
        trend,
        delta: prevSell != null ? sell - prevSell : null,
      });
    }

    const now = new Date();
    return renderRateCardPng({
      rows,
      date: format(now, 'dd.MM.yyyy'),
      time: format(now, 'HH:mm'),
      config: cfg,
      theme: cardTheme,
    });
  }

  async getAllActive() {
    return this.prisma.rate.findMany({
      where: { status: 'ACTIVE' },
      include: { exchangePoint: true },
      orderBy: [{ exchangePointId: 'asc' }, { currency: 'asc' }],
    });
  }
}
