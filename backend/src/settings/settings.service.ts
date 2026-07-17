import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RateCardConfig, DEFAULT_CARD_CONFIG, CardTheme, parseCardTheme } from '../telegram/rate-card';

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
    channels?: { id: string; label?: string; theme?: string; pointId?: number | null }[];
    rateAutopost?: boolean;
  }): Promise<void> {
    // Порожній рядок = очистити (повернутись до env-fallback, якщо він є).
    if (dto.token !== undefined) await this.set('telegram_bot_token', dto.token.trim());
    if (dto.chatId !== undefined) await this.set('telegram_chat_id', dto.chatId.trim());
    if (dto.channels !== undefined) {
      const clean = dto.channels
        .map((c) => ({
          id: String(c.id ?? '').trim(),
          label: String(c.label ?? '').trim(),
          // Тема картки цього каналу; порожньо = глобальна тема з налаштувань.
          theme: parseCardTheme(c.theme),
          // Точка каналу: пост іде в канал лише при зміні курсу ЦІЄЇ точки.
          pointId: c.pointId != null && Number.isFinite(Number(c.pointId)) ? Number(c.pointId) : null,
        }))
        .filter((c) => c.id);
      await this.set('telegram_channels', JSON.stringify(clean));
    }
    if (dto.rateAutopost !== undefined) await this.set('telegram_rate_autopost', String(dto.rateAutopost));
  }

  /** Список каналів для постів про курси (окремо від чату адмін-сповіщень). */
  async getTelegramChannels(): Promise<
    { id: string; label: string; theme?: CardTheme; pointId: number | null }[]
  > {
    const raw = await this.get('telegram_channels');
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? arr
            .map((c: any) => ({
              id: String(c.id ?? '').trim(),
              label: String(c.label ?? '').trim(),
              theme: parseCardTheme(c.theme),
              pointId: c.pointId != null && Number.isFinite(Number(c.pointId)) ? Number(c.pointId) : null,
            }))
            .filter((c) => c.id)
        : [];
    } catch {
      return [];
    }
  }

  /** Канали конкретної точки (+ канали без точки — «загальні», йдуть завжди). */
  async getChannelsForPoint(pointId: number) {
    const all = await this.getTelegramChannels();
    return all.filter((c) => c.pointId == null || c.pointId === pointId);
  }

  /** Чи публікувати оновлені курси в канали автоматично при зміні. */
  async getRateAutopost(): Promise<boolean> {
    return (await this.get('telegram_rate_autopost')) === 'true';
  }

  /** Стиль картки курсів (classic за замовчуванням). */
  async getRateCardTheme(): Promise<CardTheme> {
    return parseCardTheme(await this.get('rate_card_theme')) ?? 'classic';
  }

  async setRateCardTheme(theme: CardTheme): Promise<void> {
    await this.set('rate_card_theme', parseCardTheme(theme) ?? 'classic');
  }

  /**
   * Адміни бота: telegram user id → системний користувач (від чиєго імені
   * оновлюється курс). Лише вони можуть міняти курс через бота.
   */
  async getBotAdmins(): Promise<{ tgId: number; userId: number; name: string }[]> {
    const raw = await this.get('telegram_bot_admins');
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr)
        ? arr
            .map((a: any) => ({ tgId: Number(a.tgId), userId: Number(a.userId), name: String(a.name ?? '') }))
            .filter((a) => Number.isFinite(a.tgId) && Number.isFinite(a.userId))
        : [];
    } catch {
      return [];
    }
  }

  async setBotAdmins(admins: { tgId: number; userId: number; name?: string }[]): Promise<void> {
    const clean = admins
      .map((a) => ({ tgId: Number(a.tgId), userId: Number(a.userId), name: String(a.name ?? '').trim() }))
      .filter((a) => Number.isFinite(a.tgId) && Number.isFinite(a.userId));
    await this.set('telegram_bot_admins', JSON.stringify(clean));
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
   * Глобальний (`rate_card`) + перекриття по точці (`rate_card_point_<id>`):
   * адреси/телефони точок різні, а бренд/слоган зазвичай спільні.
   * pointId → повертаємо вміст точки поверх глобального; без нього — глобальний.
   */
  private parseCardConfig(raw: string | null, base: RateCardConfig): RateCardConfig {
    if (!raw) return base;
    try {
      return { ...base, ...(JSON.parse(raw) as Partial<RateCardConfig>) };
    } catch {
      return base;
    }
  }

  async getRateCardConfig(pointId?: number): Promise<RateCardConfig> {
    const global = this.parseCardConfig(await this.get('rate_card'), DEFAULT_CARD_CONFIG);
    if (pointId == null) return global;
    // Вміст точки — поверх глобального (лише задані поля перекривають).
    return this.parseCardConfig(await this.get(`rate_card_point_${pointId}`), global);
  }

  async setRateCardConfig(cfg: Partial<RateCardConfig>, pointId?: number): Promise<RateCardConfig> {
    if (pointId == null) {
      const merged = { ...(await this.getRateCardConfig()), ...cfg };
      await this.set('rate_card', JSON.stringify(merged));
      return merged;
    }
    // Вміст точки — повний знімок (фронт надсилає всі поля). Merge з попереднім
    // збереженим лишаємо для forward-сумісності, якщо додадуться нові поля.
    let prev: Partial<RateCardConfig> = {};
    const prevRaw = await this.get(`rate_card_point_${pointId}`);
    if (prevRaw) {
      try { prev = JSON.parse(prevRaw) as Partial<RateCardConfig>; } catch { prev = {}; }
    }
    const merged = { ...prev, ...cfg };
    await this.set(`rate_card_point_${pointId}`, JSON.stringify(merged));
    return this.getRateCardConfig(pointId);
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

  // Чи може касир створювати витрати. За замовчуванням — ні (лише адмін).
  async getCashierCanExpenses(): Promise<boolean> {
    return (await this.get('cashier_can_expenses')) === 'true'; // default false
  }

  async setCashierCanExpenses(enabled: boolean): Promise<void> {
    await this.set('cashier_can_expenses', String(enabled));
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
