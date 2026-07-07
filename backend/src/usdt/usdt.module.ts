import { Module } from '@nestjs/common';
import { UsdtService } from './usdt.service';
import { UsdtController } from './usdt.controller';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [UsdtService],
  controllers: [UsdtController],
  exports: [UsdtService],
})
export class UsdtModule {}
