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
    try {
      await axios.post(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        chat_id: cfg.chatId,
        text: message,
        parse_mode: 'HTML',
      });
      return true;
    } catch (e: any) {
      this.logger.error('Помилка Telegram:', e?.response?.data?.description ?? e.message);
      return false;
    }
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
