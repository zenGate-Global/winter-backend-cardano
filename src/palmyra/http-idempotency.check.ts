import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Logger, LoggerErrorInterceptor, LoggerModule } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import {
  Check,
  CheckStatus,
  CheckType,
} from '../check/entities/check.entity.js';
import { CheckService } from '../check/check.service.js';
import { PalmyraController } from './palmyra.controller.js';
import { deriveJobId, deriveRequestFingerprint } from './idempotency.js';
import { PalmyraService } from './palmyra.service.js';
import type { TxQueueJobData, TxQueueJobKind } from './palmyra-queue.types.js';

const execFileAsync = promisify(execFile);
const IMAGE = 'postgres:16-alpine';

type QueuedJob = { kind: TxQueueJobKind; data: TxQueueJobData<TxQueueJobKind> };

function makeBarrier(parties: number): () => Promise<void> {
  let arrivals = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrivals += 1;
    if (arrivals === parties) release();
    await ready;
  };
}

class AtomicMapQueue {
  readonly effects = new Map<string, QueuedJob>();
  effectCount = 0;
  calls = 0;
  barrier: (() => Promise<void>) | null = null;
  constructor(private readonly breakNonAtomic: boolean) {}
  reset(): void {
    this.effects.clear();
    this.effectCount = 0;
    this.calls = 0;
    this.barrier = null;
  }
  async enqueue<K extends TxQueueJobKind>(
    kind: K,
    data: TxQueueJobData<K>,
  ): Promise<void> {
    this.calls += 1;
    const key = `${kind}:${data.id}`;
    if (this.breakNonAtomic) {
      const missing = !this.effects.has(key);
      if (this.barrier) await this.barrier();
      if (missing) {
        this.effects.set(key, {
          kind,
          data: data as TxQueueJobData<TxQueueJobKind>,
        });
        this.effectCount += 1;
      }
      return;
    }
    if (this.barrier) await this.barrier();
    if (!this.effects.has(key)) {
      this.effects.set(key, {
        kind,
        data: data as TxQueueJobData<TxQueueJobKind>,
      });
      this.effectCount += 1;
    }
  }
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const rec = error as Record<string, unknown>;
  if (typeof rec.code === 'string') return rec.code;
  if (rec.driverError && typeof rec.driverError === 'object') {
    const drv = rec.driverError as Record<string, unknown>;
    if (typeof drv.code === 'string') return drv.code;
  }
  return undefined;
}

function assertAccepted(res: request.Response, expectedId: string): void {
  assert.equal(res.status, 202, res.text);
  assert.equal(res.headers.location, `/check/${expectedId}`);
  assert.deepEqual(res.body, {
    message: 'accepted',
    id: expectedId,
    status: CheckStatus.PENDING,
    statusUrl: `/check/${expectedId}`,
  });
}

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await execFileAsync('docker', [
        'exec',
        container,
        'pg_isready',
        '-U',
        'postgres',
      ]);
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 500));
    }
  }
  throw new Error('disposable Postgres did not become ready');
}

async function main(): Promise<void> {
  const breakNonAtomic = process.env.BREAK_NON_ATOMIC === '1';
  const suffix = randomUUID().replaceAll('-', '');
  const container = `winter-http-idempotency-${suffix}`;
  const schema = `http_${suffix}`;
  const password = `pw-${suffix.slice(0, 12)}`;
  let dataSource: DataSource | null = null;
  let app: Awaited<
    ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>
  > extends never
    ? never
    : import('@nestjs/common').INestApplication | null = null;
  let containerStarted = false;
  let poolUrl = process.env.DATABASE_URL;

  try {
    if (!poolUrl) {
      await execFileAsync('docker', [
        'run',
        '--detach',
        '--rm',
        '--name',
        container,
        '--env',
        `POSTGRES_PASSWORD=${password}`,
        '--publish',
        '127.0.0.1::5432',
        IMAGE,
      ]);
      containerStarted = true;
      await waitForPostgres(container);
      const { stdout } = await execFileAsync('docker', [
        'port',
        container,
        '5432/tcp',
      ]);
      const port = Number(stdout.trim().split(':').at(-1));
      assert(
        Number.isInteger(port) && port > 0,
        `invalid Postgres port: ${stdout.trim()}`,
      );
      poolUrl = `postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
    }

    dataSource = new DataSource({
      type: 'postgres',
      url: poolUrl,
      schema: containerStarted ? schema : `http_${suffix}`,
      entities: [Check],
      synchronize: true,
      logging: false,
    });
    // create schema if using managed url
    if (!containerStarted) {
      const admin = new DataSource({
        type: 'postgres',
        url: poolUrl,
        logging: false,
      });
      await admin.initialize();
      await admin.query(
        `CREATE SCHEMA IF NOT EXISTS "${(dataSource.options as unknown as { schema?: string }).schema as string}"`,
      );
      await admin.destroy();
    } else {
      // container's default db needs schema creation via DataSource synchronize will create it, but ensure schema exists
      const tmp = new DataSource({
        type: 'postgres',
        url: poolUrl,
        logging: false,
      });
      await tmp.initialize();
      await tmp.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
      await tmp.destroy();
    }
    await dataSource.initialize();
    const repo = dataSource.getRepository(Check);
    const checks = new CheckService(repo);
    const queue = new AtomicMapQueue(breakNonAtomic);
    let duplicateLosers = 0;
    const realCreate = checks.create.bind(checks);
    checks.create = async (dto: Parameters<CheckService['create']>[0]) => {
      try {
        await realCreate(dto);
      } catch (e) {
        if (postgresCode(e) === '23505') duplicateLosers += 1;
        throw e;
      }
    };

    const secretMarker = 'provider-secret-marker';
    const submitBeforeRefresh = new Map<string, string>();
    const failBeforeRefresh = new Map<
      string,
      { id?: string; status?: CheckStatus }
    >();
    const providerCalls: string[] = [];
    const internalLogs: unknown[][] = [];
    const pinoLogs: string[] = [];
    const logStream = new Writable({
      write(chunk, _encoding, callback) {
        pinoLogs.push(String(chunk));
        callback();
      },
    });
    const service = Object.create(PalmyraService.prototype) as unknown as {
      logger: {
        log(message: unknown, ...optional: unknown[]): void;
        error(message: unknown, ...optional: unknown[]): void;
        warn(message: unknown, ...optional: unknown[]): void;
      };
      checkDb: CheckService;
      queue: AtomicMapQueue;
      provider: {
        fetchAssetAddresses(): Promise<unknown[]>;
        fetchAddressUTxOs(): Promise<unknown[]>;
        fetchUTxOs(txHash: string, outputIndex: number): Promise<unknown[]>;
      };
      deploymentService: {
        getLiveDeploymentByContractAddress(
          address: string,
        ): Promise<{ deploymentTxHash: string; deploymentOutputIndex: number }>;
      };
      dispatchSpendCommodity: PalmyraService['dispatchSpendCommodity'];
      dispatchTokenizeCommodity: PalmyraService['dispatchTokenizeCommodity'];
      dispatchRecreateCommodity: PalmyraService['dispatchRecreateCommodity'];
      findExistingCheck: PalmyraService['findExistingCheck'];
    };
    service.logger = {
      log: () => {},
      error: (...args: unknown[]) => internalLogs.push(args),
      warn: (...args: unknown[]) => internalLogs.push(args),
    };
    (service as unknown as Record<string, unknown>).checkDb = checks;
    (service as unknown as Record<string, unknown>).queue = queue;
    service.provider = {
      fetchAssetAddresses: async () => {
        throw new Error(secretMarker);
      },
      fetchAddressUTxOs: async () => [],
      fetchUTxOs: async (txHash: string) => {
        providerCalls.push(txHash);
        const failure = failBeforeRefresh.get(txHash);
        if (failure?.id && failure.status) {
          await repo.update({ id: failure.id }, { status: failure.status });
        }
        if (failure) throw new Error(secretMarker);
        return [{ output: { address: `addr_test_${txHash.slice(0, 8)}` } }];
      },
    };
    service.deploymentService = {
      getLiveDeploymentByContractAddress: async (address: string) => {
        const id = submitBeforeRefresh.get(address);
        if (id) await repo.update({ id }, { status: CheckStatus.SUBMITTED });
        return { deploymentTxHash: 'd'.repeat(64), deploymentOutputIndex: 7 };
      },
    };
    service.dispatchSpendCommodity =
      PalmyraService.prototype.dispatchSpendCommodity.bind(service);
    service.dispatchTokenizeCommodity =
      PalmyraService.prototype.dispatchTokenizeCommodity.bind(service);
    service.dispatchRecreateCommodity =
      PalmyraService.prototype.dispatchRecreateCommodity.bind(service);

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: [{}, logStream] })],
      controllers: [PalmyraController],
      providers: [
        { provide: PalmyraService, useValue: service },
        { provide: CheckService, useValue: checks },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useLogger(app.get(Logger));
    app.useGlobalInterceptors(new LoggerErrorInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    const http = request(app.getHttpServer());

    const providerFailure = await http
      .post('/palmyra/commodityDetails')
      .send({ tokenIds: ['asset-with-provider-failure'] });
    assert.equal(providerFailure.status, 502, providerFailure.text);
    assert.deepEqual(providerFailure.body, {
      message: 'Blockfrost API Error',
      error: 'Bad Gateway',
      statusCode: 502,
    });
    assert.equal(providerFailure.text.includes(secretMarker), false);
    assert.equal(pinoLogs.join('').includes(secretMarker), false);
    assert.deepEqual(internalLogs, [
      ['Blockfrost commodityDetails request failed'],
    ]);
    internalLogs.length = 0;

    const raceKey = 'http-same-key-race';
    const raceId = deriveJobId('tokenize-commodity', raceKey);
    const tokenizeBody = {
      tokenName: 'coffee',
      metadataReference: 'ipfs://same-record',
    };
    const precheckBarrier = makeBarrier(2);
    const realExists = checks.exists.bind(checks);
    let precheckArrivals = 0;
    checks.exists = async (id: string) => {
      const exists = await realExists(id);
      if (id === raceId && !exists && precheckArrivals < 2) {
        precheckArrivals += 1;
        await precheckBarrier();
      }
      return exists;
    };
    queue.barrier = makeBarrier(2);
    const [first, second] = await Promise.all([
      http
        .post('/palmyra/tokenizeCommodity')
        .set('Idempotency-Key', raceKey)
        .send(tokenizeBody),
      http
        .post('/palmyra/tokenizeCommodity')
        .set('Idempotency-Key', raceKey)
        .send(tokenizeBody),
    ]);
    assertAccepted(first, raceId);
    assertAccepted(second, raceId);
    assert.equal(first.body.id, second.body.id);
    assert.equal(first.headers.location, second.headers.location);
    assert.equal(first.body.status, second.body.status);
    assert.equal(
      await repo.countBy({ id: raceId }),
      1,
      'same-key race must leave one row',
    );
    assert.equal(duplicateLosers, 1, 'one insert must lose with 23505');
    assert.equal(
      queue.calls,
      2,
      'both accepted requests must reach queue boundary',
    );
    assert.equal(
      queue.effectCount,
      1,
      'same-key requests must cause one unique job effect',
    );
    assert.equal(queue.effects.size, 1);

    const changed = await http
      .post('/palmyra/tokenizeCommodity')
      .set('Idempotency-Key', raceKey)
      .send({ ...tokenizeBody, metadataReference: 'ipfs://changed-record' });
    assert.equal(changed.status, 409, changed.text);
    assert.equal(await repo.countBy({ id: raceId }), 1);
    assert.equal(
      queue.effectCount,
      1,
      'changed body must not create new effect',
    );

    const noKeyFirst = await http
      .post('/palmyra/tokenizeCommodity')
      .send(tokenizeBody);
    const noKeySecond = await http
      .post('/palmyra/tokenizeCommodity')
      .send(tokenizeBody);
    assert.equal(noKeyFirst.status, 202, noKeyFirst.text);
    assert.equal(noKeySecond.status, 202, noKeySecond.text);
    assert.notEqual(
      noKeyFirst.body.id,
      noKeySecond.body.id,
      'missing keys must receive random job IDs',
    );

    const rowsBeforeBlank = await repo.count();
    const dispatchesBeforeBlank = queue.calls;
    const effectsBeforeBlank = queue.effectCount;
    const callsBeforeBlank = providerCalls.length;
    const blankCases: Array<readonly [string, object]> = [
      ['/palmyra/tokenizeCommodity', tokenizeBody],
      [
        '/palmyra/spendCommodity',
        { utxos: [{ txHash: '1'.repeat(64), outputIndex: 0 }] },
      ],
      [
        '/palmyra/recreateCommodity',
        {
          utxos: [{ txHash: '2'.repeat(64), outputIndex: 1 }],
          newDataReferences: ['ipfs://new-record'],
        },
      ],
    ];
    for (const key of ['', '   ']) {
      for (const [path, body] of blankCases) {
        const r = await http.post(path).set('Idempotency-Key', key).send(body);
        assert.equal(r.status, 400, path + ' blank key must be 400: ' + r.text);
      }
    }
    assert.equal(
      await repo.count(),
      rowsBeforeBlank,
      'blank keys must not create rows',
    );
    assert.equal(
      queue.calls,
      dispatchesBeforeBlank,
      'blank keys must not dispatch',
    );
    assert.equal(
      queue.effectCount,
      effectsBeforeBlank,
      'blank keys must not enqueue',
    );
    assert.equal(
      providerCalls.length,
      callsBeforeBlank,
      'blank keys must not call provider',
    );

    // restore exists for replay tests
    checks.exists = realExists;
    const script = {
      singletonScript: undefined,
      objectEventScript: { txHash: 'd'.repeat(64), outputIndex: 7 },
    };
    const routes: Array<{
      scope: 'spend-commodity' | 'recreate-commodity';
      path: string;
      type: CheckType;
      body: (h: string) => object;
    }> = [
      {
        scope: 'spend-commodity',
        path: '/palmyra/spendCommodity',
        type: CheckType.SPEND,
        body: (h: string) => ({ utxos: [{ txHash: h, outputIndex: 0 }] }),
      },
      {
        scope: 'recreate-commodity',
        path: '/palmyra/recreateCommodity',
        type: CheckType.RECREATE,
        body: (h: string) => ({
          utxos: [{ txHash: h, outputIndex: 0 }],
          newDataReferences: ['ipfs://replacement'],
        }),
      },
    ];
    for (const [idx, route] of routes.entries()) {
      queue.reset();
      submitBeforeRefresh.clear();
      const submittedKey = `${route.scope}-submitted-replay`;
      const submittedId = deriveJobId(route.scope, submittedKey);
      const submittedHash = String(idx + 3).repeat(64);
      const submittedBody = route.body(submittedHash) as Record<
        string,
        unknown
      >;
      await checks.create({
        id: submittedId,
        type: route.type,
        status: CheckStatus.PENDING,
        requestFingerprint: deriveRequestFingerprint(submittedBody),
      } as Parameters<CheckService['create']>[0]);
      submitBeforeRefresh.set(
        `addr_test_${submittedHash.slice(0, 8)}`,
        submittedId,
      );
      const subRes = await http
        .post(route.path)
        .set('Idempotency-Key', submittedKey)
        .send(submittedBody);
      assert.equal(subRes.status, 202, subRes.text);
      assert.equal(
        (await checks.findOne(submittedId)).status,
        CheckStatus.SUBMITTED,
      );
      assert.equal(
        queue.effectCount,
        0,
        `${route.scope} SUBMITTED before refresh must not enqueue`,
      );
      assert.equal(
        providerCalls.filter((h) => h === submittedHash).length,
        1,
        `${route.scope} must still enrich even when refresh blocks enqueue`,
      );

      queue.reset();
      submitBeforeRefresh.clear();
      const pendingKey = `${route.scope}-pending-replay`;
      const pendingId = deriveJobId(route.scope, pendingKey);
      const pendingHash = String(idx + 5).repeat(64);
      const pendingBody = route.body(pendingHash) as Record<string, unknown>;
      await checks.create({
        id: pendingId,
        type: route.type,
        status: CheckStatus.PENDING,
        requestFingerprint: deriveRequestFingerprint(pendingBody),
      } as Parameters<CheckService['create']>[0]);
      const pendRes = await http
        .post(route.path)
        .set('Idempotency-Key', pendingKey)
        .send(pendingBody);
      assertAccepted(pendRes, pendingId);
      assert.equal(queue.effectCount, 1, `${route.scope} pending must enqueue`);
      const queued = queue.effects.get(`${route.scope}:${pendingId}`);
      assert.ok(queued, `${route.scope} must enqueue pending replay`);
      const utxoRef = (
        queued.data as unknown as { utxoRef: Record<string, unknown> }
      ).utxoRef;
      assert.deepEqual(
        utxoRef,
        { [`addr_test_${pendingHash.slice(0, 8)}`]: script },
        `${route.scope} must include enriched utxoRef`,
      );

      queue.reset();
      internalLogs.length = 0;
      const failedKey = `${route.scope}-provider-failure-replay`;
      const failedId = deriveJobId(route.scope, failedKey);
      const failedHash = String(idx + 7).repeat(64);
      const failedBody = route.body(failedHash) as Record<string, unknown>;
      await checks.create({
        id: failedId,
        type: route.type,
        status: CheckStatus.PENDING,
        requestFingerprint: deriveRequestFingerprint(failedBody),
      } as Parameters<CheckService['create']>[0]);
      failBeforeRefresh.set(failedHash, {});
      const failedFirst = await http
        .post(route.path)
        .set('Idempotency-Key', failedKey)
        .send(failedBody);
      const failedSecond = await http
        .post(route.path)
        .set('Idempotency-Key', failedKey)
        .send(failedBody);
      assertAccepted(failedFirst, failedId);
      assertAccepted(failedSecond, failedId);
      assert.equal(
        queue.effectCount,
        1,
        `${route.scope} provider failures must cause one unique job`,
      );
      assert.equal(queue.calls, 2);
      const failedJob = queue.effects.get(`${route.scope}:${failedId}`);
      assert.ok(failedJob);
      assert.deepEqual(
        (failedJob.data as unknown as { utxoRef: Record<string, unknown> })
          .utxoRef,
        {},
        `${route.scope} provider failure must enqueue the raw payload`,
      );
      assert.deepEqual(internalLogs, [
        ['Replay enrichment deferred'],
        ['Replay enrichment deferred'],
      ]);
      assert.equal(JSON.stringify(internalLogs).includes(secretMarker), false);
      assert.equal(pinoLogs.join('').includes(secretMarker), false);
      failBeforeRefresh.delete(failedHash);

      queue.reset();
      internalLogs.length = 0;
      const failedTerminalKey = `${route.scope}-failed-terminal-replay`;
      const failedTerminalId = deriveJobId(route.scope, failedTerminalKey);
      const failedTerminalHash = (idx === 0 ? '9' : 'a').repeat(64);
      const failedTerminalBody = route.body(failedTerminalHash) as Record<
        string,
        unknown
      >;
      await checks.create({
        id: failedTerminalId,
        type: route.type,
        status: CheckStatus.PENDING,
        requestFingerprint: deriveRequestFingerprint(failedTerminalBody),
      } as Parameters<CheckService['create']>[0]);
      failBeforeRefresh.set(failedTerminalHash, {
        id: failedTerminalId,
        status: CheckStatus.SUBMITTED,
      });
      const failedTerminal = await http
        .post(route.path)
        .set('Idempotency-Key', failedTerminalKey)
        .send(failedTerminalBody);
      assert.equal(failedTerminal.status, 202, failedTerminal.text);
      assert.equal(
        (await checks.findOne(failedTerminalId)).status,
        CheckStatus.SUBMITTED,
      );
      assert.equal(
        queue.effectCount,
        0,
        `${route.scope} terminal refresh after provider failure must not enqueue`,
      );
      assert.deepEqual(internalLogs, [['Replay enrichment deferred']]);
      assert.equal(JSON.stringify(internalLogs).includes(secretMarker), false);
      assert.equal(pinoLogs.join('').includes(secretMarker), false);
      failBeforeRefresh.delete(failedTerminalHash);
    }

    queue.reset();
    const freshKey = 'tokenize-after-23505';
    const freshId = deriveJobId('tokenize-commodity', freshKey);
    const fresh = await http
      .post('/palmyra/tokenizeCommodity')
      .set('Idempotency-Key', freshKey)
      .send({
        tokenName: 'after-race',
        metadataReference: 'ipfs://after-race',
      });
    assertAccepted(fresh, freshId);
    assert.equal(await repo.countBy({ id: freshId }), 1);
    assert.equal(
      queue.effectCount,
      1,
      'tokenize must remain unchanged after 23505',
    );

    console.log('http idempotency check passed');
  } finally {
    await app?.close();
    if (dataSource?.isInitialized) {
      const schemaName = (dataSource.options as unknown as { schema?: string })
        .schema;
      await dataSource.destroy();
      if (poolUrl && schemaName) {
        const admin = new DataSource({
          type: 'postgres',
          url: poolUrl,
          logging: false,
        });
        await admin.initialize();
        await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        await admin.destroy();
      }
    }
    if (containerStarted)
      await execFileAsync('docker', ['rm', '--force', container]).catch(
        () => undefined,
      );
  }
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
