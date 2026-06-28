import { Module } from '@nestjs/common';
import { ReconciliationsService } from './reconciliations.service';
import { ReconciliationsController } from './reconciliations.controller';

@Module({ providers: [ReconciliationsService], controllers: [ReconciliationsController], exports: [ReconciliationsService] })
export class ReconciliationsModule {}
