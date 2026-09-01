import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';

import { CheckService } from '../check/check.service.js';
import {
  Check,
  CheckStatus,
  CheckType,
} from '../check/entities/check.entity.js';
import { PalmyraReconcilerService } from './palmyra.reconciler.service.js';

const execFileAsync = promisify(execFile);
const IMAGE = 'postgres:16-alpine';

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await execFileAsync('docker', [
        'exec',
        container,
        'pg_isready',
        '--username',
        'postgres',
        '--dbname',
        'postgres',
      ]);
      return;
    } catch {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 250);
      await promise;
    }
  }
  throw new Error('disposable Postgres did not become ready');
}

async function main(): Promise<void> {
  const suffix = randomUUID();
  const container = `winter-reconciler-rotation-${suffix}`;
  const idPrefix = `rotation-${suffix}`;
  const previousBatchSize = process.env.RECONCILE_BATCH_SIZE;
  let containerStarted = false;
  let dataSource: DataSource | undefined;

  delete process.env.RECONCILE_BATCH_SIZE;

  try {
    await execFileAsync('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      container,
      '--publish',
      '127.0.0.1::5432',
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      IMAGE,
    ]);
    containerStarted = true;
    await waitForPostgres(container);

    const { stdout } = await execFileAsync('docker', [
      'port',
      container,
      '5432/tcp',
    ]);
    const port = stdout.trim().split(':').at(-1);
    assert.match(port ?? '', /^\d+$/, 'Docker must publish the Postgres port');

    dataSource = new DataSource({
      type: 'postgres',
      url: `postgres://postgres@127.0.0.1:${port}/postgres`,
      entities: [Check],
      synchronize: true,
      logging: false,
    });
    await dataSource.initialize();

    const checkDb = new CheckService(dataSource.getRepository(Check));
    const seen: string[] = [];
    const provider = {
      blocksLatest: async () => ({ height: 100 }),
      genesis: async () => ({ security_param: 1, network_magic: 1 }),
      blocks: async () => ({}),
      txs: async (txid: string) => {
        seen.push(txid);
        throw { status_code: 404 };
      },
    };
    const reconciler = Object.create(
      PalmyraReconcilerService.prototype,
    ) as PalmyraReconcilerService;
    Object.assign(reconciler as unknown as Record<string, unknown>, {
      bf: provider,
      checkDb,
      configService: new ConfigService({ CHAIN_CONFIRMATION_DEPTH: '1' }),
      logger: new Logger(PalmyraReconcilerService.name),
    });

    const txids = Array.from({ length: 26 }, (_, index) =>
      index.toString(16).padStart(64, '0'),
    );
    for (const [index, txid] of txids.entries()) {
      await checkDb.create({
        id: `${idPrefix}-${index.toString().padStart(2, '0')}`,
        type: CheckType.SPEND,
        status: CheckStatus.SUBMITTED,
      });
      await dataSource
        .getRepository(Check)
        .update(
          { id: `${idPrefix}-${index.toString().padStart(2, '0')}` },
          { txid, lastChainCheckAt: null },
        );
    }

    const first = await reconciler.sweep();
    const firstSeen = new Set(seen);
    const second = await reconciler.sweep();
    const allSeen = new Set(seen);

    assert.deepEqual(first, { examined: 25, promoted: 0 });
    assert.equal(
      firstSeen.size,
      25,
      'the first default batch must contain 25 rows',
    );
    assert.deepEqual(second, { examined: 25, promoted: 0 });
    assert.equal(allSeen.size, 26, 'two sweeps must reach all 26 rows');
    assert.deepEqual(
      allSeen,
      new Set(txids),
      'the provider must see every seeded transaction exactly by identity',
    );
    assert.equal(
      await dataSource
        .getRepository(Check)
        .countBy({ lastChainCheckAt: IsNull() }),
      0,
      'markChainAttempt must persist an attempt for every row',
    );

    console.log(
      `reconciler rotation check passed: first=${first.examined} second=${second.examined} distinct=${allSeen.size}`,
    );
  } finally {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (containerStarted) {
      await execFileAsync('docker', ['rm', '--force', container]);
    }
    if (previousBatchSize === undefined)
      delete process.env.RECONCILE_BATCH_SIZE;
    else process.env.RECONCILE_BATCH_SIZE = previousBatchSize;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
