import { Module } from '@nestjs/common';
import { PalmyraController } from './palmyra.controller';
import { PalmyraService } from './palmyra.service';
import { PalmyraConsumerService } from './palmyra.consumer.service';
import { BullModule } from '@nestjs/bull';
import { TransactionsService } from '../transactions/transactions.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { ConfigService } from '@nestjs/config';
import { Check } from '../check/entities/check.entity';
import { CheckService } from '../check/check.service';
import { DeploymentService } from '../deployment/deployment.service';
import { Deployment } from '../deployment/entities/deployment.entity';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST'),
          port: configService.get('REDIS_PORT'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: 'tx-queue',
    }),
    TypeOrmModule.forFeature([Check, Transaction, Deployment]),
  ],
  controllers: [PalmyraController],
  providers: [
    PalmyraService,
    PalmyraConsumerService,
    TransactionsService,
    CheckService,
    DeploymentService,
  ],
})
export class PalmyraModule {}
