import { Module } from '@nestjs/common';
import { CashMovementsService } from './cash-movements.service';
import { CashMovementsController } from './cash-movements.controller';
import { CashBankModule } from '../cash-bank/cash-bank.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [CashBankModule, SettingsModule],
  providers: [CashMovementsService],
  controllers: [CashMovementsController],
  exports: [CashMovementsService],
})
export class CashMovementsModule {}
