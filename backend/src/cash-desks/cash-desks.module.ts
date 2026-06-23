import { Module } from '@nestjs/common';
import { CashDesksService } from './cash-desks.service';
import { CashDesksController } from './cash-desks.controller';

@Module({ providers: [CashDesksService], controllers: [CashDesksController], exports: [CashDesksService] })
export class CashDesksModule {}
