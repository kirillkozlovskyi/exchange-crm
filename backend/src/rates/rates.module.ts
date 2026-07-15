import { Module } from '@nestjs/common';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';
import { NbuAutoService } from './nbu-auto.service';
import { TelegramBotService } from './telegram-bot.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  providers: [RatesService, NbuAutoService, TelegramBotService],
  controllers: [RatesController],
  exports: [RatesService],
})
export class RatesModule {}
