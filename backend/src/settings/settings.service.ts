import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const s = await this.prisma.setting.findUnique({ where: { key } });
    return s?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async getStornoWindowMinutes(): Promise<number> {
    const v = await this.get('storno_window_minutes');
    return v !== null ? parseInt(v, 10) : 5;
  }

  async setStornoWindowMinutes(minutes: number): Promise<void> {
    await this.set('storno_window_minutes', String(minutes));
  }

  async getNbuRates(): Promise<{ buyPct: number; sellPct: number }> {
    const [buy, sell] = await Promise.all([
      this.get('nbu_buy_pct'),
      this.get('nbu_sell_pct'),
    ]);
    return {
      buyPct: buy !== null ? parseFloat(buy) : -5,
      sellPct: sell !== null ? parseFloat(sell) : 5,
    };
  }

  async setNbuRates(buyPct: number, sellPct: number): Promise<void> {
    await Promise.all([
      this.set('nbu_buy_pct', String(buyPct)),
      this.set('nbu_sell_pct', String(sellPct)),
    ]);
  }

  async getBalanceEditEnabled(): Promise<boolean> {
    const v = await this.get('cashier_can_edit_balance');
    return v !== 'false'; // default true
  }

  async setBalanceEditEnabled(enabled: boolean): Promise<void> {
    await this.set('cashier_can_edit_balance', String(enabled));
  }

  async getCurrencyOrder(): Promise<string[]> {
    const v = await this.get('currency_order');
    if (!v) return [];
    try { return JSON.parse(v); } catch { return []; }
  }

  async setCurrencyOrder(order: string[]): Promise<void> {
    await this.set('currency_order', JSON.stringify(order));
  }

  async getQuickAmounts(): Promise<number[]> {
    const v = await this.get('quick_amounts');
    if (!v) return [10, 20, 50, 100, 500];
    try { return JSON.parse(v); } catch { return [10, 20, 50, 100, 500]; }
  }

  async setQuickAmounts(amounts: number[]): Promise<void> {
    await this.set('quick_amounts', JSON.stringify([...amounts].sort((a, b) => a - b)));
  }

  // Назва організації (для чеків). Порожньо = не друкувати.
  async getOrgName(): Promise<string> {
    return (await this.get('org_name')) ?? '';
  }

  async setOrgName(name: string): Promise<void> {
    await this.set('org_name', name.trim());
  }
}
