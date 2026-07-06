import { Global, Module } from '@nestjs/common';
import { ProfitService } from './profit.service';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [ProfitService],
  exports: [ProfitService],
})
export class ProfitModule {}
