import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PalmyraModule } from './palmyra/palmyra.module';
import { DatabaseModule } from './database/database.module';
import { TransactionsModule } from './transactions/transactions.module';
import { LoggerModule } from 'nestjs-pino';
import { CheckModule } from './check/check.module';
import { IpfsModule } from './ipfs/ipfs.module';
import { DeploymentModule } from './deployment/deployment.module';
import { ApiKeyGuard } from './api-key.guard';

const cloudSeverity: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: (config: Record<string, unknown>) => {
        const required = [
          'POSTGRES_SYNC',
          'POSTGRES_LOGGING',
          'NETWORK',
          'BLOCKFROST_KEY',
          'PINATA_JWT',
          'NEXT_PUBLIC_GATEWAY_URL',
          'DEPLOYER_ADDRESS',
          'ZENGATE_WALLET_MNEMONIC',
          'WINTER_API_KEY',
        ];
        const missing = required.filter((k) => {
          const v = config[k];
          return v === undefined || v === null || String(v).trim() === '';
        });
        if (missing.length) {
          throw new Error(
            `Missing required environment variables: ${missing.join(', ')}`,
          );
        }
        if (!config.PORT || String(config.PORT).trim() === '') {
          config.PORT = '4000';
        }
        if (
          config.CHAIN_CONFIRMATION_DEPTH !== undefined &&
          config.CHAIN_CONFIRMATION_DEPTH !== null
        ) {
          const raw = String(config.CHAIN_CONFIRMATION_DEPTH);
          if (raw === '') {
            // empty treated as absent, use genesis
          } else if (!/^[1-9][0-9]*$/.test(raw)) {
            throw new Error(
              'CHAIN_CONFIRMATION_DEPTH must be a positive safe integer',
            );
          } else {
            const num = Number(raw);
            if (!Number.isSafeInteger(num) || num <= 0) {
              throw new Error(
                'CHAIN_CONFIRMATION_DEPTH must be a positive safe integer',
              );
            }
          }
        }
        const network = String(config.NETWORK).toLowerCase();
        const bfKey = String(config.BLOCKFROST_KEY);
        if (bfKey.startsWith('http')) {
          console.log(
            `BLOCKFROST_KEY http override in use for network ${network}`,
          );
        } else if (!bfKey.toLowerCase().startsWith(network)) {
          throw new Error(
            `BLOCKFROST_KEY network prefix does not match NETWORK (${network})`,
          );
        } else {
          console.log(`Resolved network: ${network}`);
        }
        return config;
      },
    }),
    PalmyraModule,
    DatabaseModule,
    TransactionsModule,
    CheckModule,
    DeploymentModule,
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.x-api-key',
            'req.headers.authorization',
            'req.headers["x-api-key"]',
          ],
          censor: '[redacted]',
        },
        formatters: {
          level: (label) => ({ severity: cloudSeverity[label] }),
        },
        customLogLevel: (_req, res, err) =>
          err || res.statusCode >= 500 ? 'error' : 'info',
        customProps: () => ({ context: 'HTTP' }),
        ...(process.env.K_SERVICE
          ? {}
          : {
              transport: {
                target: 'pino-pretty',
                options: { singleLine: true },
              },
            }),
      },
    }),
    IpfsModule,
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class AppModule {}
