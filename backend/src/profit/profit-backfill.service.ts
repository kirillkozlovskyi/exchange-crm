import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitService } from './profit.service';

// Одноразовий беквіл прибутку під $-числовник («каса в доларах») при першому
// старті після деплою: перераховує ВСЮ історію (рішення власника 2026-07-17).
// Захищено прапорцем у Settings, щоб не повторювався щоразу.
@Injectable()
export class ProfitBackfillService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProfitBackfillService.name);

  constructor(
    private prisma: PrismaService,
    private profit: ProfitService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const flag = await this.prisma.setting.findUnique({ where: { key: 'usd_backfill_done' } });
      if (flag?.value === 'true') return;
      this.logger.log('$-беквіл: перший старт — перераховуємо історію прибутку...');
      await this.profit.backfillAll();
      await this.prisma.setting.upsert({
        where: { key: 'usd_backfill_done' },
        create: { key: 'usd_backfill_done', value: 'true' },
        update: { value: 'true' },
      });
      this.logger.log('$-беквіл: завершено.');
    } catch (e) {
      this.logger.error('$-беквіл: помилка (боот продовжено)', e as any);
    }
  }
}
