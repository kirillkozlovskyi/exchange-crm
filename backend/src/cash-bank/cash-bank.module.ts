import { Module } from '@nestjs/common';
import { CashBankService } from './cash-bank.service';
import { CashBankController } from './cash-bank.controller';
import { UsdtModule } from '../usdt/usdt.module';

@Module({
  imports: [UsdtModule],
  providers: [CashBankService],
  controllers: [CashBankController],
  exports: [CashBankService],
})
export class CashBankModule {}
