import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { CashBankService } from './cash-bank.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('cash-bank')
export class CashBankController {
  constructor(private service: CashBankService) {}

  // Баланси доступні всім автентифікованим (каса читає, якщо ввімкнено в
  // налаштуваннях — гейт на фронті). Мутації — лише адмін.
  @Get()
  getBalances() {
    return this.service.getBalances();
  }

  @Get('company')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SENIOR_CASHIER')
  getCompanyBalance() {
    return this.service.getCompanyBalance();
  }

  @Get('movements')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SENIOR_CASHIER')
  getMovements() {
    return this.service.getMovements();
  }

  @Post('deposit')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  deposit(@Body() dto: { currency: string; amount: number; note?: string }, @CurrentUser() user: any) {
    return this.service.deposit(dto, user.sub);
  }

  @Post('withdraw')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  withdraw(@Body() dto: { currency: string; amount: number; note?: string }, @CurrentUser() user: any) {
    return this.service.withdraw(dto, user.sub);
  }
}
