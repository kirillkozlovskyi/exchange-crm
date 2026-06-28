import { Module } from '@nestjs/common';
import { CashMovementsService } from './cash-movements.service';
import { CashMovementsController } from './cash-movements.controller';

@Module({ providers: [CashMovementsService], controllers: [CashMovementsController], exports: [CashMovementsService] })
export class CashMovementsModule {}
