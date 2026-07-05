import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token = process.env.TELEGRAM_BOT_TOKEN;
  private readonly chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  async send(message: string) {
    if (!this.token || !this.chatId) {
      this.logger.warn('Telegram не налаштовано — пропускаємо сповіщення');
      return;
    }
    try {
      await axios.post(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        chat_id: this.chatId,
        text: message,
        parse_mode: 'HTML',
      });
    } catch (e) {
      this.logger.error('Помилка Telegram:', e.message);
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
