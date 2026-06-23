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

  async notifyShiftClosed(shiftNumber: string, cashierName: string, profit: number) {
    await this.send(`🔴 <b>Зміна закрита</b>\n👤 ${cashierName}\n🔢 ${shiftNumber}\n💰 Прибуток: ${profit.toFixed(2)} UAH`);
  }

  async notifyTransfer(from: string, to: string, currency: string, amount: number) {
    await this.send(`💸 <b>Передача грошей</b>\n📤 ${from} → 📥 ${to}\n${amount} ${currency}`);
  }
}
