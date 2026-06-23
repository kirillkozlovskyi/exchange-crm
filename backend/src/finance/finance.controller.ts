import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('finance')
export class FinanceController {
  constructor(private service: FinanceService) {}

  @Get('daily')
  daily(@Query('date') date?: string) {
    return this.service.getDailySummary(date ? new Date(date) : new Date());
  }

  @Get('weekly')
  weekly(@Query('date') date?: string) {
    return this.service.getWeeklySummary(date ? new Date(date) : new Date());
  }

  @Get('monthly')
  monthly(@Query('date') date?: string) {
    return this.service.getMonthlySummary(date ? new Date(date) : new Date());
  }
}
