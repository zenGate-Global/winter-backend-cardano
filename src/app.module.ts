import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { PalmyraModule } from './palmyra/palmyra.module';
import { DatabaseModule } from './database/database.module';
import { TransactionsModule } from './transactions/transactions.module';
import { LoggerModule } from 'nestjs-pino';
import { CheckModule } from './check/check.module';
import { IpfsModule } from './ipfs/ipfs.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PalmyraModule,
    DatabaseModule,
    TransactionsModule,
    CheckModule,
    LoggerModule.forRoot({
      pinoHttp: {
        customProps: (req, res) => ({
          context: 'HTTP',
        }),
        transport: {
          target: 'pino-pretty',
          options: {
            singleLine: true,
          },
        },
      },
    }),
    IpfsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
