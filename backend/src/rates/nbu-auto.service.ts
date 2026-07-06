import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { format } from 'date-fns';

const NBU_URL = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json';
const round4 = (n: number) => Math.round(n * 10000) / 10000;

// Автопідтягування курсів НБУ за розкладом. Раз на годину перевіряє: якщо
// увімкнено (nbu_auto_update) і сьогодні ще не оновлювали — тягне курси НБУ й
// оновлює активні курси кожної точки як НБУ ± задані % (nbu_buy_pct/nbu_sell_pct).
// Оновлення in-place (без нових версій), щоб не роздувати історію.
@Injectable()
export class NbuAutoService implements OnModuleInit {
  private readonly logger = new Logger(NbuAutoService.name);

  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
  ) {}

  onModuleInit() {
    // Перша перевірка невдовзі після старту, далі щогодини.
    setTimeout(() => this.tick().catch(() => {}), 30_000);
    setInterval(() => this.tick().catch(() => {}), 60 * 60 * 1000);
  }

  async tick() {
    if (!(await this.settings.getNbuAutoUpdate())) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    if ((await this.settings.get('nbu_last_run')) === today) return;

    const map = await this.fetchNbu();
    if (!map) return; // мережева помилка — спробуємо на наступному тіку

    const { buyPct, sellPct } = await this.settings.getNbuRates();
    const active = await this.prisma.rate.findMany({ where: { status: 'ACTIVE' } });
    let updated = 0;
    for (const rt of active) {
      const nbu = map[rt.currency];
      if (!nbu || !(nbu > 0)) continue;
      await this.prisma.rate.update({
        where: { id: rt.id },
        data: { buy: round4(nbu * (1 + buyPct / 100)), sell: round4(nbu * (1 + sellPct / 100)) },
      });
      updated += 1;
    }
    await this.settings.set('nbu_last_run', today);
    this.logger.log(`НБУ-автокурси: оновлено ${updated} курс(ів) за ${today}`);
  }

  private async fetchNbu(): Promise<Record<string, number> | null> {
    try {
      const res = await fetch(NBU_URL);
      if (!res.ok) return null;
      const list = (await res.json()) as { cc: string; rate: number }[];
      const map: Record<string, number> = {};
      for (const r of list) map[r.cc] = Number(r.rate);
      return map;
    } catch {
      return null;
    }
  }
}
