import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PalmyraConsumerService } from './palmyra.consumer.service.js';
import {
  TX_QUEUE_NAME,
  TxQueueJob,
  TxQueueJobData,
  TxQueueJobKind,
} from './palmyra-queue.types.js';

type PgBossClient = import('pg-boss').PgBoss;
type PgBossConstructorOptions = import('pg-boss').ConstructorOptions;

@Injectable()
export class PalmyraQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PalmyraQueueService.name);
  private boss?: PgBossClient;
  private workerId?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly consumerService: PalmyraConsumerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const { PgBoss } = await import('pg-boss');
    const boss = new PgBoss(this.getConnectionOptions());

    boss.on('error', (error) => {
      this.logger.error(`pg-boss error: ${this.formatError(error)}`);
    });
    boss.on('warning', (warning) => {
      this.logger.warn(`pg-boss warning: ${this.formatError(warning)}`);
    });

    await boss.start();
    await boss.createQueue(TX_QUEUE_NAME, {
      policy: 'singleton',
      retryLimit: 2,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 300,
      expireInSeconds: 1800,
      heartbeatSeconds: 60,
      deleteAfterSeconds: 604800,
      warningQueueSize: 100,
    });

    this.workerId = await boss.work<TxQueueJob>(
      TX_QUEUE_NAME,
      {
        localConcurrency: 1,
        pollingIntervalSeconds: 2,
        heartbeatRefreshSeconds: 30,
      },
      async ([job]) => {
        if (!job) {
          return;
        }
        await this.consumerService.processJob(job.data);
      },
    );

    this.boss = boss;
    this.logger.log(
      `pg-boss queue '${TX_QUEUE_NAME}' started with worker ${this.workerId}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.boss) {
      return;
    }

    await this.boss.stop({ graceful: true, timeout: 30000 });
    this.logger.log(`pg-boss queue '${TX_QUEUE_NAME}' stopped`);
  }

  async enqueue<K extends TxQueueJobKind>(
    kind: K,
    data: TxQueueJobData<K>,
  ): Promise<string> {
    if (!this.boss) {
      throw new Error('pg-boss has not started');
    }

    const payload = { kind, data } as TxQueueJob;
    const id = await this.boss.send(TX_QUEUE_NAME, payload, { id: data.id });

    if (!id) {
      throw new Error(`pg-boss did not enqueue ${kind} job ${data.id}`);
    }

    return id;
  }

  private getConnectionOptions(): PgBossConstructorOptions {
    return {
      host: this.getRequiredConfig('POSTGRES_HOST'),
      port: this.getNumberConfig('POSTGRES_PORT', 5432),
      database: this.getRequiredConfig('POSTGRES_DB'),
      user: this.getRequiredConfig('POSTGRES_USER'),
      password: this.getRequiredConfig('POSTGRES_PASSWORD'),
      schema: this.getConfig('PGBOSS_SCHEMA', 'pgboss'),
      max: this.getNumberConfig('PGBOSS_POOL_MAX', 2),
      application_name: 'winter-backend-cardano-pgboss',
    };
  }

  private getConfig(key: string, fallback: string): string {
    const value = this.configService.get<string>(key);
    return value && value.trim().length > 0 ? value : fallback;
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value || value.trim().length === 0) {
      throw new Error(`${key} is required for pg-boss`);
    }
    return value;
  }

  private getNumberConfig(key: string, fallback: number): number {
    const value = this.configService.get<string | number>(key);
    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
      throw new Error(`${key} must be a number`);
    }

    return numberValue;
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : JSON.stringify(error);
  }
}
