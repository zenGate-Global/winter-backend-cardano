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

// `import type` is erased at compile time, so pg-boss stays a runtime dynamic
// import, which this project requires for module interop.
import type {
  ConstructorOptions as PgBossConstructorOptions,
  JobWithMetadata,
  PgBoss as PgBossClient,
} from 'pg-boss';

// One constant so the createQueue option and the exhaustion check cannot drift.
// Note that the createQueue options apply only when the queue row is first
// created, so changing this does nothing to an existing database.
const TX_QUEUE_RETRY_LIMIT = 2;
export const TX_QUEUE_CREATE_OPTIONS = {
  policy: 'singleton',
  retryLimit: TX_QUEUE_RETRY_LIMIT,
  retryDelay: 30,
  retryBackoff: true,
  retryDelayMax: 300,
  expireInSeconds: 1800,
  heartbeatSeconds: 60,
  deleteAfterSeconds: 604800,
  warningQueueSize: 100,
} as const;
export const TX_QUEUE_WORK_OPTIONS = {
  localConcurrency: 1,
  pollingIntervalSeconds: 2,
  heartbeatRefreshSeconds: 30,
  includeMetadata: true,
} as const;

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
    await boss.createQueue(TX_QUEUE_NAME, TX_QUEUE_CREATE_OPTIONS);

    this.workerId = await boss.work<TxQueueJob>(
      TX_QUEUE_NAME,
      TX_QUEUE_WORK_OPTIONS,
      async (jobs) => {
        const [job] = jobs as unknown as JobWithMetadata<TxQueueJob>[];
        if (!job) {
          return;
        }
        try {
          await this.consumerService.processJob(job.data);
        } catch (error) {
          // A rethrown job goes back to pg-boss for retry. On the final attempt
          // nothing else writes a terminal state, so the check row would sit at
          // QUEUED for ever and a caller would poll it for ever.
          const attempt = (job.retryCount ?? 0) + 1;
          const limit = (job.retryLimit ?? TX_QUEUE_RETRY_LIMIT) + 1;
          if (attempt >= limit) {
            await this.consumerService.markRetriesExhausted(
              job.data.data.id,
              error,
            );
          }
          throw error;
        }
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

  // Returns the pg-boss job id, or 'already-queued' when a job with this id is
  // already on the queue. pg-boss answers a duplicate `id` with null, and that
  // is its deduplication guarantee, not a failure. A caller that retries a
  // request with the same idempotency key lands here.
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
      this.logger.log(`${kind} job ${data.id} is already queued`);
      return 'already-queued';
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
