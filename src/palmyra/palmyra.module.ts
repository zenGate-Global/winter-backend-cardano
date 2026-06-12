import { Module } from '@nestjs/common';
import { PalmyraController } from './palmyra.controller';
import { PalmyraService } from './palmyra.service';
import { PalmyraConsumerService } from './palmyra.consumer.service';
import { TransactionsService } from '../transactions/transactions.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from '../transactions/entities/transaction.entity';
import { Check } from '../check/entities/check.entity';
import { CheckService } from '../check/check.service';
import { DeploymentService } from '../deployment/deployment.service';
import { Deployment } from '../deployment/entities/deployment.entity';
import { PalmyraQueueService } from './palmyra-queue.service';

@Module({
  imports: [TypeOrmModule.forFeature([Check, Transaction, Deployment])],
  controllers: [PalmyraController],
  providers: [
    PalmyraService,
    PalmyraConsumerService,
    PalmyraQueueService,
    TransactionsService,
    CheckService,
    DeploymentService,
  ],
})
export class PalmyraModule {}
