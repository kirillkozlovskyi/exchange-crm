import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RateCardConfig, DEFAULT_CARD_CONFIG, CardTheme } from '../telegram/rate-card';

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

  // Автопідтягування курсів НБУ за розкладом (щодня). Default OFF — щоб не
  // змінювати живі курси без явного дозволу адміна.
  async getNbuAutoUpdate(): Promise<boolean> {
    return (await this.get('nbu_auto_update')) === 'true';
  }

  async setNbuAutoUpdate(enabled: boolean): Promise<void> {
    await this.set('nbu_auto_update', String(enabled));
  }

  async getBalanceEditEnabled(): Promise<boolean> {
    const v = await this.get('cashier_can_edit_balance');
    return v !== 'false'; // default true
  }

  async setBalanceEditEnabled(enabled: boolean): Promise<void> {
    await this.set('cashier_can_edit_balance', String(enabled));
  }

  // ── Telegram (токен зберігається в БД; env — fallback у TelegramService) ──
  async getTelegramMasked(): Promise<{ tokenMasked: string; chatId: string; configured: boolean; channels: { id: string; label: string }[]; rateAutopost: boolean }> {
    const [token, chatId] = await Promise.all([
      this.get('telegram_bot_token'),
      this.get('telegram_chat_id'),
    ]);
    const effToken = token || process.env.TELEGRAM_BOT_TOKEN || '';
    const effChat = chatId || process.env.TELEGRAM_ADMIN_CHAT_ID || '';
    const autopost = await this.get('telegram_rate_autopost');
    return {
      // Показуємо лише хвіст токена — цього досить, щоб упізнати бота.
      tokenMasked: effToken ? `••••${effToken.slice(-6)}` : '',
      chatId: effChat,
      configured: !!(effToken && effChat),
      // Канали для постів про курси (окремо від чату сповіщень) + режим автопостингу.
      channels: await this.getTelegramChannels(),
      rateAutopost: autopost === 'true',
    };
  }

  async setTelegram(dto: {
    token?: string;
    chatId?: string;
    channels?: { id: string; label?: string }[];
    rateAutopost?: boolean;
  }): Promise<void> {
    // Порожній рядок = очистити (повернутись до env-fallback, якщо він є).
    if (dto.token !== undefined) await this.set('telegram_bot_token', dto.token.trim());
    if (dto.chatId !== undefined) await this.set('telegram_chat_id', dto.chatId.trim());
    if (dto.channels !== undefined) {
      const clean = dto.channels
        .map((c) => ({ id: String(c.id ?? '').trim(), label: String(c.label ?? '').trim() }))
        .filter((c) => c.id);
      await this.set('telegram_channels', JSON.stringify(clean));
    }
    if (dto.rateAutopost !== undefined) await this.set('telegram_rate_autopost', String(dto.rateAutopost));
  }

  /** Список каналів для постів про курси (окремо від чату адмін-сповіщень). */
  async getTelegramChannels(): Promise<{ id: string; label: string }[]> {
    const raw = await this.get('telegram_channels');
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? arr.map((c: any) => ({ id: String(c.id ?? '').trim(), label: String(c.label ?? '').trim() })).filter((c) => c.id)
        : [];
    } catch {
      return [];
    }
  }

  /** Чи публікувати оновлені курси в канали автоматично при зміні. */
  async getRateAutopost(): Promise<boolean> {
    return (await this.get('telegram_rate_autopost')) === 'true';
  }

  /** Стиль картки курсів: classic | dark | minimal. */
  async getRateCardTheme(): Promise<CardTheme> {
    const v = await this.get('rate_card_theme');
    return v === 'dark' || v === 'minimal' ? v : 'classic';
  }

  async setRateCardTheme(theme: CardTheme): Promise<void> {
    await this.set('rate_card_theme', theme);
  }

  /** Постити курси КАРТИНКОЮ (макет каналу) замість тексту. */
  async getRatePostAsImage(): Promise<boolean> {
    return (await this.get('telegram_rate_image')) === 'true'; // default false
  }

  async setRatePostAsImage(enabled: boolean): Promise<void> {
    await this.set('telegram_rate_image', String(enabled));
  }

  /**
   * Статичний вміст картки курсів (бренд, адреса, телефони, графік, послуги).
   * Зберігаємо в налаштуваннях, щоб змінювати без правки коду.
   */
  async getRateCardConfig(): Promise<RateCardConfig> {
    const raw = await this.get('rate_card');
    if (!raw) return DEFAULT_CARD_CONFIG;
    try {
      return { ...DEFAULT_CARD_CONFIG, ...(JSON.parse(raw) as Partial<RateCardConfig>) };
    } catch {
      return DEFAULT_CARD_CONFIG;
    }
  }

  async setRateCardConfig(cfg: Partial<RateCardConfig>): Promise<RateCardConfig> {
    const merged = { ...(await this.getRateCardConfig()), ...cfg };
    await this.set('rate_card', JSON.stringify(merged));
    return merged;
  }

  // Поріг «великої операції» в грн для Telegram-сповіщення (0 = вимкнено).
  async getLargeOpUah(): Promise<number> {
    const v = await this.get('large_op_uah');
    const n = v !== null ? parseFloat(v) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async setLargeOpUah(amount: number): Promise<void> {
    await this.set('large_op_uah', String(Number(amount) || 0));
  }

  // Чи бачить касир баланс глобального банку готівки (за замовчуванням — ні).
  async getCashierCanSeeBank(): Promise<boolean> {
    const v = await this.get('cashier_can_see_bank');
    return v === 'true'; // default false
  }

  async setCashierCanSeeBank(enabled: boolean): Promise<void> {
    await this.set('cashier_can_see_bank', String(enabled));
  }

  // Чи бачить касир прибуток каси (живий лічильник на екрані каси і блок
  // «Прибуток за зміну» при закритті). За замовчуванням — так.
  async getCashierCanSeeProfit(): Promise<boolean> {
    const v = await this.get('cashier_can_see_profit');
    return v !== 'false'; // default true
  }

  async setCashierCanSeeProfit(enabled: boolean): Promise<void> {
    await this.set('cashier_can_see_profit', String(enabled));
  }

  /**
   * Чи використовується глобальний банк готівки. Вимкнено → гроші живуть лише
   * по касах: у русі готівки немає джерела «Банк», сторінка «Банк» ховається.
   * За замовчуванням увімкнено (як було до появи налаштування).
   */
  async getCashBankEnabled(): Promise<boolean> {
    const v = await this.get('cash_bank_enabled');
    return v !== 'false'; // default true
  }

  async setCashBankEnabled(enabled: boolean): Promise<void> {
    await this.set('cash_bank_enabled', String(enabled));
  }

  /**
   * Чи показувати «маржу з відкупу» — додатковий показник поруч із прибутком
   * (модель замовника: заробіток кільця «продав валюту → відкупив на гривню»).
   * За замовчуванням вимкнено — щоб не плутати два числа без потреби.
   */
  async getBuybackMarginEnabled(): Promise<boolean> {
    const v = await this.get('buyback_margin_enabled');
    return v === 'true'; // default false
  }

  async setBuybackMarginEnabled(enabled: boolean): Promise<void> {
    await this.set('buyback_margin_enabled', String(enabled));
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

  // Окремий набір швидких сум для USDT-операцій (кнопки −/+ у вікні USDT).
  async getUsdtQuickAmounts(): Promise<number[]> {
    const v = await this.get('usdt_quick_amounts');
    if (!v) return [100, 500, 1000];
    try { return JSON.parse(v); } catch { return [100, 500, 1000]; }
  }

  async setUsdtQuickAmounts(amounts: number[]): Promise<void> {
    await this.set('usdt_quick_amounts', JSON.stringify([...amounts].sort((a, b) => a - b)));
  }

  // Назва організації (для чеків). Порожньо = не друкувати.
  async getOrgName(): Promise<string> {
    return (await this.get('org_name')) ?? '';
  }

  async setOrgName(name: string): Promise<void> {
    await this.set('org_name', name.trim());
  }
}
