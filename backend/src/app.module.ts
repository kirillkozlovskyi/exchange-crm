import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ExchangePointsModule } from './exchange-points/exchange-points.module';
import { CashDesksModule } from './cash-desks/cash-desks.module';
import { RatesModule } from './rates/rates.module';
import { ShiftsModule } from './shifts/shifts.module';
import { OperationsModule } from './operations/operations.module';
import { TransfersModule } from './transfers/transfers.module';
import { FinanceModule } from './finance/finance.module';
import { TelegramModule } from './telegram/telegram.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { SettingsModule } from './settings/settings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ReconciliationsModule } from './reconciliations/reconciliations.module';
import { CashMovementsModule } from './cash-movements/cash-movements.module';
import { SeedService } from './seed.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    TelegramModule,
    CurrenciesModule,
    SettingsModule,
    AuthModule,
    UsersModule,
    ExchangePointsModule,
    CashDesksModule,
    RatesModule,
    ShiftsModule,
    OperationsModule,
    TransfersModule,
    FinanceModule,
    NotificationsModule,
    ReconciliationsModule,
    CashMovementsModule,
  ],
  providers: [SeedService],
})
export class AppModule {}
