import assert from 'node:assert/strict';
import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CheckStatus } from '../check/entities/check.entity.js';
import { deriveRequestFingerprint } from './idempotency.js';
import { PalmyraService } from './palmyra.service.js';
import { PalmyraController } from './palmyra.controller.js';
import { CheckService } from '../check/check.service.js';
type CheckRow = {
  id: string;
  requestFingerprint: string | null;
  status: CheckStatus;
};
type JobData = {
  id: string;
  utxos?: { txHash: string; outputIndex: number }[];
  newDataReferences?: string[];
  utxoRef?: unknown;
};
type PrivateServiceAccess = {
  logger: unknown;
  checkDb: unknown;
  queue: unknown;
  provider: unknown;
  deploymentService: unknown;
  alreadyAccepted: (
    kind: string,
    data: JobData,
    fp: string | null,
  ) => Promise<boolean>;
  createCheckAndEnqueue: (
    kind: string,
    data: JobData,
    check: CheckRow,
  ) => Promise<void>;
  enrichUtxoRef: (
    utxos: { txHash: string; outputIndex: number }[],
    existing?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  dispatchSpendCommodity: (data: JobData, fp: string | null) => Promise<void>;
  dispatchRecreateCommodity: (
    data: JobData,
    fp: string | null,
  ) => Promise<void>;
};
function checkRow(
  status = CheckStatus.PENDING,
  requestFingerprint: string | null = null,
  id = 'job',
): CheckRow {
  return { id, requestFingerprint, status };
}
function fakeCheckDb({
  existing = null,
  exists = existing !== null,
  createError,
  lookupError,
}: {
  existing?: CheckRow | null;
  exists?: boolean;
  createError?: unknown;
  lookupError?: Error;
} = {}) {
  return {
    exists: async () => exists,
    findOne: async () => {
      if (lookupError) throw lookupError;
      return existing;
    },
    create: async () => {
      if (createError) throw createError;
    },
    update: async () => {},
  };
}
function fakeQueue() {
  const calls: { kind: string; data: JobData }[] = [];
  return {
    calls,
    queue: {
      enqueue: async (kind: string, data: JobData) => {
        calls.push({ kind, data });
      },
    },
  };
}
function fakeChainServices(outputIndex = 5) {
  const providerCalls: [string, number][] = [];
  const deploymentCalls: string[] = [];
  return {
    providerCalls,
    deploymentCalls,
    provider: {
      fetchUTxOs: async (txHash: string, index: number) => {
        providerCalls.push([txHash, index]);
        return [{ output: { address: 'addr_test1xyz' } }];
      },
    },
    deploymentService: {
      getLiveDeploymentByContractAddress: async (address: string) => {
        deploymentCalls.push(address);
        return {
          deploymentTxHash: 'deplHash',
          deploymentOutputIndex: outputIndex,
        };
      },
    },
  };
}
function makeService({
  checkDb = fakeCheckDb(),
  queue = fakeQueue().queue,
  provider,
  deploymentService,
}: {
  checkDb?: unknown;
  queue?: unknown;
  provider?: unknown;
  deploymentService?: unknown;
} = {}): PrivateServiceAccess {
  const service = Object.create(
    PalmyraService.prototype,
  ) as PrivateServiceAccess;
  service.logger = { log: () => {}, error: () => {}, warn: () => {} };
  service.checkDb = checkDb;
  service.queue = queue;
  service.provider =
    provider ??
    ({
      fetchUTxOs: async () => {
        throw new Error('provider must not be called');
      },
    } as object);
  service.deploymentService =
    deploymentService ??
    ({
      getLiveDeploymentByContractAddress: async () => {
        throw new Error('deployment service must not be called');
      },
    } as object);
  return service;
}
async function assertConflict(
  action: () => Promise<unknown>,
  message: string,
): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ConflictException, `${message} must conflict`);
    assert.equal(
      (error as ConflictException).getStatus(),
      409,
      `${message} must return 409`,
    );
    return true;
  });
}
function duplicateError(driver = false): Error {
  return driver
    ? Object.assign(new Error('duplicate'), { driverError: { code: '23505' } })
    : Object.assign(new Error('duplicate'), { code: '23505' });
}
async function checkFingerprints(): Promise<void> {
  const canonical = deriveRequestFingerprint({ b: 2, a: 1, c: { y: 2, x: 1 } });
  assert.equal(
    canonical,
    deriveRequestFingerprint({ a: 1, c: { x: 1, y: 2 }, b: 2 }),
    'object key order must not change the fingerprint',
  );
  assert.notEqual(
    canonical,
    deriveRequestFingerprint({ b: 2, a: 2, c: { y: 2, x: 1 } }),
    'a changed field must change the fingerprint',
  );
  assert.notEqual(
    deriveRequestFingerprint({ arr: [1, 2, 3] }),
    deriveRequestFingerprint({ arr: [3, 2, 1] }),
    'array order must remain significant',
  );
}
async function checkAlreadyAccepted(): Promise<void> {
  const matching = deriveRequestFingerprint({ x: 1 });
  const different = deriveRequestFingerprint({ x: 2 });
  const missingQueue = fakeQueue();
  const missing = makeService({ queue: missingQueue.queue });
  assert.equal(
    await missing.alreadyAccepted(
      'tokenize-commodity',
      { id: 'missing' },
      matching,
    ),
    false,
    'a missing check must not be accepted',
  );
  assert.equal(
    missingQueue.calls.length,
    0,
    'a missing check must not enqueue',
  );
  const cases = [
    ['matching PENDING', CheckStatus.PENDING, matching, matching, 1, false],
    ['matching SUCCESS', CheckStatus.SUCCESS, matching, matching, 0, false],
    ['mismatched PENDING', CheckStatus.PENDING, matching, different, 0, true],
    ['legacy null PENDING', CheckStatus.PENDING, null, different, 1, false],
    ['legacy null SUCCESS', CheckStatus.SUCCESS, null, different, 0, false],
    ['incoming null PENDING', CheckStatus.PENDING, matching, null, 1, false],
  ] as const;
  for (const [name, status, stored, incoming, enqueues, conflicts] of cases) {
    const queued = fakeQueue();
    const service = makeService({
      checkDb: fakeCheckDb({ existing: checkRow(status, stored) }),
      queue: queued.queue,
    });
    const action = () =>
      service.alreadyAccepted('tokenize-commodity', { id: 'job' }, incoming);
    if (conflicts) await assertConflict(action, name);
    else assert.equal(await action(), true, `${name} must be accepted`);
    assert.equal(queued.calls.length, enqueues, `${name} enqueue count`);
  }
}
async function checkInsertRaces(): Promise<void> {
  const matching = deriveRequestFingerprint({ x: 1 });
  const different = deriveRequestFingerprint({ x: 2 });
  const cases = [
    [
      'matching PENDING',
      CheckStatus.PENDING,
      matching,
      matching,
      1,
      false,
      false,
    ],
    [
      'matching SUCCESS',
      CheckStatus.SUCCESS,
      matching,
      matching,
      0,
      false,
      false,
    ],
    [
      'mismatched PENDING',
      CheckStatus.PENDING,
      matching,
      different,
      0,
      true,
      false,
    ],
    [
      'legacy null PENDING',
      CheckStatus.PENDING,
      null,
      different,
      1,
      false,
      false,
    ],
    [
      'driverError PENDING',
      CheckStatus.PENDING,
      matching,
      matching,
      1,
      false,
      true,
    ],
  ] as const;
  for (const [
    name,
    status,
    stored,
    incoming,
    enqueues,
    conflicts,
    driver,
  ] of cases) {
    const queued = fakeQueue();
    const service = makeService({
      checkDb: fakeCheckDb({
        existing: checkRow(status, stored),
        createError: duplicateError(driver),
      }),
      queue: queued.queue,
    });
    const action = () =>
      service.createCheckAndEnqueue(
        'tokenize-commodity',
        { id: 'job' },
        checkRow(CheckStatus.PENDING, incoming),
      );
    if (conflicts) await assertConflict(action, `23505 ${name}`);
    else await action();
    assert.equal(queued.calls.length, enqueues, `23505 ${name} enqueue count`);
  }
  const lookupError = new Error('lookup failed');
  for (const [name, checkDb] of [
    [
      'lookup failure',
      fakeCheckDb({ createError: duplicateError(), exists: true, lookupError }),
    ],
    ['missing race row', fakeCheckDb({ createError: duplicateError() })],
  ] as const) {
    const service = makeService({ checkDb });
    await assert.rejects(
      () =>
        service.createCheckAndEnqueue(
          'tokenize-commodity',
          { id: 'job' },
          checkRow(CheckStatus.PENDING, matching),
        ),
      (error: unknown) => {
        assert.ok(
          error instanceof InternalServerErrorException,
          `23505 ${name} must return an internal server error`,
        );
        assert.equal(
          (error as InternalServerErrorException).getStatus(),
          500,
          `23505 ${name} must return 500`,
        );
        assert.equal(
          (error as InternalServerErrorException).cause,
          undefined,
          `23505 ${name} must not expose its cause`,
        );
        return true;
      },
    );
  }
}
const routes = [
  {
    name: 'spend',
    data: (id: string): JobData => ({
      id,
      utxos: [{ txHash: 'abc', outputIndex: 0 }],
      utxoRef: {},
    }),
    dispatch: (s: PrivateServiceAccess, d: JobData, fp: string) =>
      s.dispatchSpendCommodity(d, fp),
  },
  {
    name: 'recreate',
    data: (id: string): JobData => ({
      id,
      utxos: [{ txHash: 'abc', outputIndex: 0 }],
      newDataReferences: ['cid1'],
      utxoRef: {},
    }),
    dispatch: (s: PrivateServiceAccess, d: JobData, fp: string) =>
      s.dispatchRecreateCommodity(d, fp),
  },
] as const;
async function checkRouteReplays(): Promise<void> {
  const matching = deriveRequestFingerprint({ x: 1 });
  const different = deriveRequestFingerprint({ x: 2 });
  for (const [routeIndex, route] of routes.entries()) {
    for (const [caseName, status, incoming, expectedEnqueue, conflicts] of [
      ['mismatch', CheckStatus.PENDING, different, 0, true],
      ['terminal', CheckStatus.SUCCESS, matching, 0, false],
      ['PENDING', CheckStatus.PENDING, matching, 1, false],
    ] as const) {
      const id = `${route.name}-${caseName}`;
      const queued = fakeQueue();
      const chain = fakeChainServices(5 + routeIndex * 2);
      const service = makeService({
        checkDb: fakeCheckDb({ existing: checkRow(status, matching, id) }),
        queue: queued.queue,
        provider: chain.provider,
        deploymentService: chain.deploymentService,
      });
      const action = () => route.dispatch(service, route.data(id), incoming);
      if (conflicts) await assertConflict(action, `${route.name} mismatch`);
      else await action();
      assert.equal(
        chain.providerCalls.length,
        expectedEnqueue,
        `${route.name} ${caseName} provider call count`,
      );
      assert.equal(
        chain.deploymentCalls.length,
        expectedEnqueue,
        `${route.name} ${caseName} deployment call count`,
      );
      assert.equal(
        queued.calls.length,
        expectedEnqueue,
        `${route.name} ${caseName} enqueue count`,
      );
      if (expectedEnqueue) {
        assert.deepEqual(queued.calls[0].data.utxoRef, {
          addr_test1xyz: {
            singletonScript: undefined,
            objectEventScript: {
              txHash: 'deplHash',
              outputIndex: 5 + routeIndex * 2,
            },
          },
        });
      }
    }
  }
}
async function checkCompleteReplayReferences(): Promise<void> {
  const existing = {
    addr_test1_existing: {
      singletonScript: undefined,
      objectEventScript: { txHash: 'old-deployment', outputIndex: 1 },
    },
  };
  const service = makeService({
    provider: {
      fetchUTxOs: async (txHash: string) => {
        if (txHash === 'missing') return [];
        return [
          {
            output: {
              address:
                txHash === 'existing'
                  ? 'addr_test1_existing'
                  : 'addr_test1_new',
            },
          },
        ];
      },
    },
    deploymentService: {
      getLiveDeploymentByContractAddress: async (address: string) => {
        if (address === 'addr_test1_missing') throw new Error('missing');
        return {
          deploymentTxHash: 'new-deployment',
          deploymentOutputIndex: 2,
        };
      },
    },
  });
  const enriched = await service.enrichUtxoRef(
    [
      { txHash: 'existing', outputIndex: 0 },
      { txHash: 'new', outputIndex: 1 },
    ],
    existing,
  );
  assert.notEqual(enriched, existing);
  assert.deepEqual(enriched, {
    ...existing,
    addr_test1_new: {
      singletonScript: undefined,
      objectEventScript: { txHash: 'new-deployment', outputIndex: 2 },
    },
  });
  assert.deepEqual(existing, {
    addr_test1_existing: {
      singletonScript: undefined,
      objectEventScript: { txHash: 'old-deployment', outputIndex: 1 },
    },
  });
  await assert.rejects(
    service.enrichUtxoRef([{ txHash: 'missing', outputIndex: 0 }], existing),
    /Requested UTxO was not found/,
  );
}
async function checkControllerHashIdentity(): Promise<void> {
  const calls: { data: JobData; fingerprint: string | null }[] = [];
  const service = {
    dispatchSpendCommodity: async (
      data: JobData,
      fingerprint: string | null,
    ) => {
      calls.push({ data, fingerprint });
    },
    dispatchRecreateCommodity: async (
      data: JobData,
      fingerprint: string | null,
    ) => {
      calls.push({ data, fingerprint });
    },
  } as unknown as PalmyraService;
  const checks = {
    findOne: async (id: string) => checkRow(CheckStatus.PENDING, null, id),
  } as unknown as CheckService;
  const controller = new PalmyraController(service, checks);
  const response = { setHeader: () => {} } as never;
  const hash = 'ABCDEF0123456789'.repeat(4);

  const lower = await controller.spendCommodity(
    { utxos: [{ txHash: hash.toLowerCase(), outputIndex: 2 }] },
    'case-key',
    response,
  );
  const upper = await controller.spendCommodity(
    { utxos: [{ txHash: hash, outputIndex: 2 }] },
    'case-key',
    response,
  );

  assert.equal(
    upper.id,
    lower.id,
    'hash case must not change request identity',
  );
  assert.equal(
    calls[1].fingerprint,
    calls[0].fingerprint,
    'hash case must not change request fingerprint',
  );
  assert.deepEqual(calls[1].data.utxos, [
    { txHash: hash.toLowerCase(), outputIndex: 2 },
  ]);

  await controller.spendCommodity(
    { utxos: [{ txHash: hash, outputIndex: 3 }] },
    undefined,
    response,
  );
  assert.equal(calls[2].fingerprint, null, 'a missing key must remain unbound');

  const secondHash = 'FEDCBA9876543210'.repeat(4);
  await controller.recreateCommodity(
    {
      utxos: [
        { txHash: hash, outputIndex: 3 },
        { txHash: secondHash, outputIndex: 1 },
      ],
      newDataReferences: ['first', 'second'],
    },
    undefined,
    response,
  );
  assert.equal(
    calls[3].fingerprint,
    null,
    'a missing recreate key must remain unbound',
  );
  assert.deepEqual(calls[3].data.utxos, [
    { txHash: hash.toLowerCase(), outputIndex: 3 },
    { txHash: secondHash.toLowerCase(), outputIndex: 1 },
  ]);
  assert.deepEqual(calls[3].data.newDataReferences, ['first', 'second']);
}
async function checkPersistedHashNormalization(): Promise<void> {
  type StoredCheck = CheckRow & {
    additionalInfo?: {
      utxos: { txHash: string; outputIndex: number }[];
      newDataReferences: string[];
      utxoRef: unknown;
    };
  };
  let existing: StoredCheck | null = null;
  const created: StoredCheck[] = [];
  const checkDb = {
    exists: async () => existing !== null,
    findOne: async () => existing,
    create: async (check: StoredCheck) => {
      created.push(check);
      existing = check;
    },
    update: async () => {},
  };
  const queued = fakeQueue();
  const chain = fakeChainServices();
  const service = makeService({
    checkDb,
    queue: queued.queue,
    provider: chain.provider,
    deploymentService: chain.deploymentService,
  });
  const controller = new PalmyraController(
    service as unknown as PalmyraService,
    checkDb as unknown as CheckService,
  );
  const response = { setHeader: () => {} } as never;
  const firstHash = 'ABCDEF0123456789'.repeat(4);
  const secondHash = 'FEDCBA9876543210'.repeat(4);
  const lowerUtxos = [
    { txHash: firstHash.toLowerCase(), outputIndex: 4 },
    { txHash: secondHash.toLowerCase(), outputIndex: 1 },
  ];
  const newDataReferences = ['first', 'second'];

  const first = await controller.recreateCommodity(
    {
      utxos: [
        { txHash: firstHash, outputIndex: 4 },
        { txHash: secondHash, outputIndex: 1 },
      ],
      newDataReferences,
    },
    'persisted-case-key',
    response,
  );

  assert.equal(created.length, 1);
  assert.deepEqual(created[0].additionalInfo, {
    utxos: lowerUtxos,
    newDataReferences,
    utxoRef: {},
  });
  assert.deepEqual(queued.calls[0].data.utxos, lowerUtxos);

  const replay = await controller.recreateCommodity(
    { utxos: lowerUtxos, newDataReferences },
    'persisted-case-key',
    response,
  );

  assert.equal(replay.id, first.id);
  assert.equal(created.length, 1, 'same normalized request must reuse its row');
  assert.deepEqual(chain.providerCalls, [
    [firstHash.toLowerCase(), 4],
    [secondHash.toLowerCase(), 1],
  ]);
  assert.deepEqual(queued.calls[1].data.utxos, lowerUtxos);
}
async function main(): Promise<void> {
  await checkFingerprints();
  await checkAlreadyAccepted();
  await checkInsertRaces();
  await checkRouteReplays();
  await checkCompleteReplayReferences();
  await checkControllerHashIdentity();
  await checkPersistedHashNormalization();
  console.log('idempotency check passed');
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
