import { Module } from '@nestjs/common';
import { ExchangePointsService } from './exchange-points.service';
import { ExchangePointsController } from './exchange-points.controller';

@Module({ providers: [ExchangePointsService], controllers: [ExchangePointsController], exports: [ExchangePointsService] })
export class ExchangePointsModule {}
