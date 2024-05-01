import { Module } from '@nestjs/common';
import { PalmyraController } from './palmyra.controller';
import { PalmyraService } from './palmyra.service';
import { PalmyraConsumerService } from './palmyra.consumer.service';
import { BullModule } from '@nestjs/bull';
import { TransactionsService } from '../transactions/transactions.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { ConfigService } from '@nestjs/config';

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
      limiter: {
        max: 1,
        duration: 10000,
      },
    }),
    TypeOrmModule.forFeature([Transaction]),
  ],
  controllers: [PalmyraController],
  providers: [PalmyraService, PalmyraConsumerService, TransactionsService],
})
export class PalmyraModule {}