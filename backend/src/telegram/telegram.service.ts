import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Сповіщення в Telegram. Конфіг: спершу з БД (налаштовується в адмінці —
 * ключі telegram_bot_token / telegram_chat_id), як fallback — змінні оточення
 * TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID. Без конфігу — тихий скіп.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private prisma: PrismaService) {}

  private async getConfig(): Promise<{ token: string; chatId: string } | null> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: ['telegram_bot_token', 'telegram_chat_id'] } },
    });
    const db = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const token = db.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '';
    const chatId = db.telegram_chat_id || process.env.TELEGRAM_ADMIN_CHAT_ID || '';
    return token && chatId ? { token, chatId } : null;
  }

  /** Надіслати повідомлення. Повертає true/false (для тест-кнопки в адмінці). */
  async send(message: string): Promise<boolean> {
    const cfg = await this.getConfig();
    if (!cfg) {
      this.logger.warn('Telegram не налаштовано — пропускаємо сповіщення');
      return false;
    }
    return this.sendTo(cfg.token, cfg.chatId, message);
  }

  /** Низькорівнева відправка в конкретний chat_id заданим токеном. */
  private async sendTo(token: string, chatId: string, message: string): Promise<boolean> {
    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      });
      return true;
    } catch (e: any) {
      this.logger.error(`Помилка Telegram (${chatId}):`, e?.response?.data?.description ?? e.message);
      return false;
    }
  }

  /** Токен бота (з БД або env) — для постів у канали курсів. */
  private async getToken(): Promise<string> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'telegram_bot_token' } });
    return row?.value || process.env.TELEGRAM_BOT_TOKEN || '';
  }

  /**
   * Публікація повідомлення в кілька каналів (курси). Повертає, у скільки
   * каналів надіслано успішно / скільки всього.
   */
  async postToChannels(channels: { id: string }[], message: string): Promise<{ sent: number; total: number }> {
    const token = await this.getToken();
    if (!token || !channels.length) return { sent: 0, total: channels.length };
    let sent = 0;
    for (const ch of channels) {
      if (await this.sendTo(token, ch.id, message)) sent += 1;
    }
    return { sent, total: channels.length };
  }

  /** Форматований пост курсів точки для каналу. */
  formatRates(pointName: string, rates: { currency: string; buy: number | string; sell: number | string }[]): string {
    const dt = new Date().toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const lines = rates.map((r) => {
      const cur = r.currency.padEnd(4);
      const buy = Number(r.buy).toFixed(2).padStart(8);
      const sell = Number(r.sell).toFixed(2).padStart(8);
      return `${cur}${buy} / ${sell}`;
    });
    return (
      `📊 <b>Курси валют — ${this.esc(pointName)}</b>\n` +
      `🕐 ${dt}\n\n` +
      `<pre>Валюта  Купівля /  Продаж\n${lines.join('\n')}</pre>`
    );
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async notifyShiftOpened(shiftNumber: string, cashierName: string, pointName: string) {
    await this.send(`🟢 <b>Зміна відкрита</b>\n📍 ${pointName}\n👤 ${cashierName}\n🔢 ${shiftNumber}`);
  }

  async notifyShiftClosed(
    shiftNumber: string,
    cashierName: string,
    profit: number,
    factualProfit?: number,
  ) {
    const lines = [
      `🔴 <b>Зміна закрита</b>`,
      `👤 ${cashierName}`,
      `🔢 ${shiftNumber}`,
      `💰 Торговий прибуток: <b>${profit.toFixed(2)} ₴</b>`,
    ];
    if (factualProfit != null) {
      const diff = factualProfit - profit;
      lines.push(`📊 Фактичний результат: <b>${factualProfit.toFixed(2)} ₴</b>`);
      if (Math.abs(diff) >= 0.01)
        lines.push(`⚠️ Нестача/надлишок каси: <b>${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ₴</b>`);
    }
    await this.send(lines.join('\n'));
  }

  async notifyTransfer(from: string, to: string, currency: string, amount: number) {
    await this.send(`💸 <b>Передача грошей</b>\n📤 ${from} → 📥 ${to}\n${amount} ${currency}`);
  }

  // Розбіжність у проміжній звірці касира.
  async notifyDiscrepancy(pointName: string, cashierName: string, diffs: string[]) {
    await this.send(
      `⚠️ <b>Розбіжність у звірці</b>\n📍 ${pointName}\n👤 ${cashierName}\n` + diffs.join('\n'),
    );
  }

  // Операція понад поріг (налаштування «Поріг великої операції»).
  async notifyLargeOperation(
    pointName: string,
    cashierName: string,
    type: string,
    amount: number,
    currency: string,
    totalUah: number,
  ) {
    const kind = type === 'BUY' ? 'Купівля' : 'Продаж';
    await this.send(
      `💵 <b>Велика операція</b>\n📍 ${pointName}\n👤 ${cashierName}\n` +
        `${kind} <b>${amount.toFixed(2)} ${currency}</b> ≈ ${totalUah.toFixed(2)} ₴`,
    );
  }
}
