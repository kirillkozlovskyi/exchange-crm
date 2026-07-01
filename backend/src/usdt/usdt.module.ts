import { Module } from '@nestjs/common';
import { UsdtService } from './usdt.service';
import { UsdtController } from './usdt.controller';

@Module({ providers: [UsdtService], controllers: [UsdtController], exports: [UsdtService] })
export class UsdtModule {}
