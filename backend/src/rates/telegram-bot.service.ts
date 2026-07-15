import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { RatesService } from './rates.service';

/**
 * Двосторонній Telegram-бот: приймає команди зміни курсу в приваті.
 *
 * Механізм — long-polling getUpdates (не webhook): працює і локально, і на
 * Railway без публічного URL. Той самий токен, що й для сповіщень.
 *
 * Авторизація: лише telegram-адміни з whitelist (settings.getBotAdmins) можуть
 * міняти курс; від їхнього імені (userId) робиться upsert. Незнайомим бот
 * повертає їхній telegram id, щоб адмін додав його в налаштуваннях.
 *
 * Формат команди (приклад):
 *   Т2
 *   USD 44.50 45.10
 *   EUR 51.00 51.80
 * Перший рядок — код точки; далі рядки «ВАЛЮТА купівля продаж». Зміна курсу
 * тригерить автопост у канали точки (як і зміна в адмінці).
 */
export interface ParsedRateCommand {
  code: string; // код точки (перший рядок)
  rows: { currency: string; buy: number; sell: number }[];
  errors: string[]; // рядки, які не вдалося розпарсити
}

/**
 * Парсер команди зміни курсу (чиста функція — тестується без БД/мережі).
 * Перший рядок — код точки; далі «ВАЛЮТА купівля продаж». Кому як десятковий
 * роздільник теж приймаємо.
 */
export function parseRateCommand(text: string): ParsedRateCommand | null {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  const code = lines[0].toUpperCase();
  const rows: ParsedRateCommand['rows'] = [];
  const errors: string[] = [];
  for (const line of lines.slice(1)) {
    const m = line.split(/\s+/);
    if (m.length < 3) { errors.push(`«${line}» — треба: ВАЛЮТА купівля продаж`); continue; }
    const currency = m[0].toUpperCase();
    const buy = Number(m[1].replace(',', '.'));
    const sell = Number(m[2].replace(',', '.'));
    if (!(buy > 0) || !(sell > 0)) { errors.push(`«${line}» — курс має бути > 0`); continue; }
    rows.push({ currency, buy, sell });
  }
  return { code, rows, errors };
}

@Injectable()
export class TelegramBotService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramBotService.name);
  private offset = 0;
  private running = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private rates: RatesService,
  ) {}

  async onApplicationBootstrap() {
    // Стартуємо лише якщо є токен — інакше бот просто не працює.
    const token = await this.token();
    if (!token) {
      this.logger.log('Telegram-бот: токен не налаштовано — команди вимкнено.');
      return;
    }
    this.running = true;
    void this.poll();
    this.logger.log('Telegram-бот: приймання команд увімкнено (long-polling).');
  }

  onModuleDestroy() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async token(): Promise<string> {
    return (await this.settings.get('telegram_bot_token')) || process.env.TELEGRAM_BOT_TOKEN || '';
  }

  private async api(method: string, body: any) {
    const token = await this.token();
    return axios.post(`https://api.telegram.org/bot${token}/${method}`, body);
  }

  private async reply(chatId: number | string, text: string) {
    try {
      await this.api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    } catch (e: any) {
      this.logger.error('reply error:', e?.response?.data?.description ?? e.message);
    }
  }

  /** Цикл long-poll. Кожна ітерація чекає до 25 с на нові апдейти. */
  private async poll() {
    if (!this.running) return;
    try {
      const { data } = await this.api('getUpdates', { offset: this.offset, timeout: 25 });
      for (const upd of data.result ?? []) {
        this.offset = upd.update_id + 1;
        const msg = upd.message;
        if (msg?.text) await this.handle(msg).catch((e) => this.logger.error('handle:', e));
      }
    } catch (e: any) {
      // Мережеві збої не мають валити цикл — просто чекаємо й пробуємо знову.
      this.logger.warn('getUpdates:', e?.response?.data?.description ?? e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
    this.timer = setTimeout(() => this.poll(), 300);
  }

  private async handle(msg: any) {
    const chatId = msg.chat.id;
    const tgId = msg.from?.id;
    const text: string = msg.text.trim();

    // Службові команди.
    if (/^\/(start|help)\b/i.test(text)) {
      return this.reply(chatId, this.helpText());
    }
    if (/^\/id\b/i.test(text)) {
      return this.reply(chatId, `Ваш Telegram ID: <code>${tgId}</code>`);
    }

    // Авторизація: лише whitelist.
    const admins = await this.settings.getBotAdmins();
    const admin = admins.find((a) => a.tgId === tgId);
    if (!admin) {
      return this.reply(
        chatId,
        `⛔ Немає доступу. Ваш Telegram ID: <code>${tgId}</code>\n` +
          `Попросіть адміністратора додати його в налаштуваннях (Сповіщення → Адміни бота).`,
      );
    }

    await this.handleRateCommand(chatId, text, admin.userId);
  }

  /** Парсить і застосовує зміну курсів. */
  private async handleRateCommand(chatId: number, text: string, userId: number) {
    const parsed = parseRateCommand(text);
    if (!parsed) return this.reply(chatId, this.helpText());

    const point = await this.prisma.exchangePoint.findFirst({
      where: { code: { equals: parsed.code, mode: 'insensitive' } },
      select: { id: true, name: true, code: true },
    });
    if (!point) {
      const all = await this.prisma.exchangePoint.findMany({ select: { code: true, name: true } });
      return this.reply(
        chatId,
        `❓ Точку з кодом <b>${parsed.code}</b> не знайдено.\nДоступні: ` +
          all.map((p) => `<b>${p.code}</b> (${p.name})`).join(', '),
      );
    }

    const applied: string[] = [];
    const errors = [...parsed.errors];
    for (const r of parsed.rows) {
      try {
        await this.rates.upsert(
          { exchangePointId: point.id, currency: r.currency, buy: r.buy, sell: r.sell },
          userId,
        );
        applied.push(`${r.currency}: ${r.buy.toFixed(2)} / ${r.sell.toFixed(2)}`);
      } catch (e: any) {
        errors.push(`${r.currency} — ${e?.message ?? 'помилка'}`);
      }
    }

    let out = applied.length
      ? `✅ Курси <b>${point.name}</b> оновлено:\n${applied.join('\n')}`
      : '⚠️ Жодного курсу не змінено.';
    if (errors.length) out += `\n\n⚠️ Пропущено:\n${errors.join('\n')}`;
    await this.reply(chatId, out);
  }

  private helpText(): string {
    return (
      '🤖 <b>Бот зміни курсів</b>\n\n' +
      'Надішліть код точки й курси, кожна валюта з нового рядка:\n\n' +
      '<code>Т2\nUSD 44.50 45.10\nEUR 51.00 51.80</code>\n\n' +
      'Формат рядка: <b>ВАЛЮТА купівля продаж</b>.\n' +
      'Курси одразу оновляться в точці й опублікуються в її канали.\n\n' +
      '/id — показати ваш Telegram ID.'
    );
  }
}
