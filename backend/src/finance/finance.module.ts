import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [ExpensesModule],
  providers: [FinanceService],
  controllers: [FinanceController],
})
export class FinanceModule {}
