import { Global, Module } from '@nestjs/common';
import { ProfitService } from './profit.service';
import { ProfitBackfillService } from './profit-backfill.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ProfitService, ProfitBackfillService],
  exports: [ProfitService],
})
export class ProfitModule {}
