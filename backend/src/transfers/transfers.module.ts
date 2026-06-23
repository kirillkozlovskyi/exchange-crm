import { Module } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { TransfersController } from './transfers.controller';

@Module({ providers: [TransfersService], controllers: [TransfersController], exports: [TransfersService] })
export class TransfersModule {}
