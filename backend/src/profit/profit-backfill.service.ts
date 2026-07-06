import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfitService } from './profit.service';

// Одноразовий беквіл прибутку під модель WAC при першому старті після деплою.
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
      const flag = await this.prisma.setting.findUnique({ where: { key: 'wac_backfill_done' } });
      if (flag?.value === 'true') return;
      this.logger.log('WAC-беквіл: перший старт — перераховуємо історію прибутку...');
      await this.profit.backfillAll();
      await this.prisma.setting.upsert({
        where: { key: 'wac_backfill_done' },
        create: { key: 'wac_backfill_done', value: 'true' },
        update: { value: 'true' },
      });
      this.logger.log('WAC-беквіл: завершено.');
    } catch (e) {
      this.logger.error('WAC-беквіл: помилка (боот продовжено)', e as any);
    }
  }
}
