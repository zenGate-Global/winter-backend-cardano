import assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { deriveRequestFingerprint } from './idempotency.js';
import { PalmyraService } from './palmyra.service.js';
import { CheckStatus } from '../check/entities/check.entity.js';

function makeService(overrides: {
  checkDb: unknown;
  queue: unknown;
  provider?: unknown;
  deploymentService?: unknown;
}): PalmyraService {
  const svc = Object.create(PalmyraService.prototype) as PalmyraService;
  (svc as unknown as Record<string, unknown>).logger = {
    log: () => {},
    error: () => {},
    warn: () => {},
  };
  (svc as unknown as Record<string, unknown>).checkDb = overrides.checkDb;
  (svc as unknown as Record<string, unknown>).queue = overrides.queue;
  (svc as unknown as Record<string, unknown>).provider = overrides.provider ?? {
    fetchUTxOs: async () => {
      throw new Error('provider.fetchUTxOs must not be called in this path');
    },
  };
  (svc as unknown as Record<string, unknown>).deploymentService =
    overrides.deploymentService ?? {
      getDeploymentByContractAddress: async () => {
        throw new Error(
          'deploymentService.getDeploymentByContractAddress must not be called in this path',
        );
      },
    };
  return svc;
}

async function main(): Promise<void> {
  const bodyA = { b: 2, a: 1, c: { y: 2, x: 1 } };
  const bodyB = { a: 1, c: { x: 1, y: 2 }, b: 2 };
  const fpA = deriveRequestFingerprint(bodyA);
  const fpB = deriveRequestFingerprint(bodyB);
  assert.equal(
    fpA,
    fpB,
    'same body with different key order must hash the same',
  );

  const bodyC = { b: 2, a: 2, c: { y: 2, x: 1 } };
  assert.notEqual(
    deriveRequestFingerprint(bodyC),
    fpA,
    'a changed field must hash differently',
  );

  const arr1 = { arr: [1, 2, 3] };
  const arr2 = { arr: [3, 2, 1] };
  assert.notEqual(
    deriveRequestFingerprint(arr1),
    deriveRequestFingerprint(arr2),
    'array order must remain significant',
  );

  {
    let enqueued = 0;
    const svc = makeService({
      checkDb: {
        exists: async () => false,
        findOne: async () => {
          throw new Error('findOne must not be called when exists is false');
        },
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    const res = await (
      svc as unknown as {
        alreadyAccepted: (
          k: string,
          d: unknown,
          f: string | null,
        ) => Promise<boolean>;
      }
    ).alreadyAccepted('tokenize-commodity', { id: 'id-missing' }, fpA);
    assert.equal(
      res,
      false,
      'alreadyAccepted must return false when id does not exist',
    );
    assert.equal(enqueued, 0, 'missing id must not enqueue');
  }

  {
    let enqueued = 0;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'id1',
          requestFingerprint: fp,
          status: CheckStatus.PENDING,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    const res = await (
      svc as unknown as {
        alreadyAccepted: (
          k: string,
          d: unknown,
          f: string | null,
        ) => Promise<boolean>;
      }
    ).alreadyAccepted('tokenize-commodity', { id: 'id1' }, fp);
    assert.equal(res, true, 'matching replay must return true');
    assert.equal(enqueued, 1, 'PENDING replay must re-enqueue once');
  }

  {
    let enqueued = 0;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'id1',
          requestFingerprint: fp,
          status: CheckStatus.SUCCESS,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    const res = await (
      svc as unknown as {
        alreadyAccepted: (
          k: string,
          d: unknown,
          f: string | null,
        ) => Promise<boolean>;
      }
    ).alreadyAccepted('tokenize-commodity', { id: 'id1' }, fp);
    assert.equal(res, true, 'matching terminal replay must return true');
    assert.equal(enqueued, 0, 'terminal SUCCESS must not re-enqueue');
  }

  {
    let enqueued = 0;
    const fp1 = deriveRequestFingerprint({ x: 1 });
    const fp2 = deriveRequestFingerprint({ x: 2 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'id1',
          requestFingerprint: fp1,
          status: CheckStatus.PENDING,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    await assert.rejects(
      async () =>
        (
          svc as unknown as {
            alreadyAccepted: (
              k: string,
              d: unknown,
              f: string | null,
            ) => Promise<boolean>;
          }
        ).alreadyAccepted('tokenize-commodity', { id: 'id1' }, fp2),
      (error: unknown) => {
        assert.ok(
          error instanceof ConflictException,
          'mismatch must throw ConflictException',
        );
        assert.equal(
          (error as ConflictException).getStatus(),
          409,
          'mismatch must be 409',
        );
        return true;
      },
    );
    assert.equal(enqueued, 0, 'mismatch must not enqueue');
  }

  {
    let enqueued = 0;
    const svcPending = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'id1',
          requestFingerprint: null,
          status: CheckStatus.PENDING,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    const fp = deriveRequestFingerprint({ x: 1 });
    const resPending = await (
      svcPending as unknown as {
        alreadyAccepted: (
          k: string,
          d: unknown,
          f: string | null,
        ) => Promise<boolean>;
      }
    ).alreadyAccepted('tokenize-commodity', { id: 'id1' }, fp);
    assert.equal(resPending, true, 'legacy null fingerprint must return true');
    assert.equal(enqueued, 1, 'legacy null PENDING must preserve re-enqueue');

    let enqueued2 = 0;
    const svcSuccess = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'id1',
          requestFingerprint: null,
          status: CheckStatus.SUCCESS,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued2 += 1;
        },
      },
    });
    const resSuccess = await (
      svcSuccess as unknown as {
        alreadyAccepted: (
          k: string,
          d: unknown,
          f: string | null,
        ) => Promise<boolean>;
      }
    ).alreadyAccepted(
      'tokenize-commodity',
      { id: 'id1' },
      deriveRequestFingerprint({ x: 999 }),
    );
    assert.equal(resSuccess, true, 'legacy null SUCCESS must return true');
    assert.equal(enqueued2, 0, 'legacy null SUCCESS must not re-enqueue');

    let enqueued3 = 0;
    const svcIncomingNull = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'id1',
          requestFingerprint: deriveRequestFingerprint({ x: 1 }),
          status: CheckStatus.PENDING,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued3 += 1;
        },
      },
    });
    const resIncomingNull = await (
      svcIncomingNull as unknown as {
        alreadyAccepted: (
          k: string,
          d: unknown,
          f: string | null,
        ) => Promise<boolean>;
      }
    ).alreadyAccepted('tokenize-commodity', { id: 'id1' }, null);
    assert.equal(
      resIncomingNull,
      true,
      'incoming null must not conflict when stored is non-null',
    );
    assert.equal(enqueued3, 1, 'incoming null PENDING must re-enqueue');
  }

  {
    let enqueued = 0;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        create: async () => {
          const error = new Error('duplicate') as Error & { code?: string };
          error.code = '23505';
          throw error;
        },
        findOne: async () => ({
          id: 'race1',
          requestFingerprint: fp,
          status: CheckStatus.PENDING,
        }),
        update: async () => {},
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    await (
      svc as unknown as {
        createCheckAndEnqueue: (
          k: string,
          d: unknown,
          c: unknown,
        ) => Promise<void>;
      }
    ).createCheckAndEnqueue(
      'tokenize-commodity',
      { id: 'race1' },
      { id: 'race1', requestFingerprint: fp, status: CheckStatus.PENDING },
    );
    assert.equal(
      enqueued,
      1,
      '23505 race with matching PENDING must re-enqueue',
    );
  }

  {
    let enqueued = 0;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        create: async () => {
          const error = new Error('duplicate') as Error & { code?: string };
          error.code = '23505';
          throw error;
        },
        findOne: async () => ({
          id: 'race2',
          requestFingerprint: fp,
          status: CheckStatus.SUCCESS,
        }),
        update: async () => {},
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    await (
      svc as unknown as {
        createCheckAndEnqueue: (
          k: string,
          d: unknown,
          c: unknown,
        ) => Promise<void>;
      }
    ).createCheckAndEnqueue(
      'tokenize-commodity',
      { id: 'race2' },
      { id: 'race2', requestFingerprint: fp, status: CheckStatus.PENDING },
    );
    assert.equal(
      enqueued,
      0,
      '23505 race with matching SUCCESS must not re-enqueue',
    );
  }

  {
    let enqueued = 0;
    const fp1 = deriveRequestFingerprint({ x: 1 });
    const fp2 = deriveRequestFingerprint({ x: 2 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        create: async () => {
          const error = new Error('duplicate') as Error & { code?: string };
          error.code = '23505';
          throw error;
        },
        findOne: async () => ({
          id: 'race3',
          requestFingerprint: fp1,
          status: CheckStatus.PENDING,
        }),
        update: async () => {},
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    await assert.rejects(
      async () =>
        (
          svc as unknown as {
            createCheckAndEnqueue: (
              k: string,
              d: unknown,
              c: unknown,
            ) => Promise<void>;
          }
        ).createCheckAndEnqueue(
          'tokenize-commodity',
          { id: 'race3' },
          { id: 'race3', requestFingerprint: fp2, status: CheckStatus.PENDING },
        ),
      (error: unknown) => {
        assert.ok(
          error instanceof ConflictException,
          '23505 mismatch must throw ConflictException',
        );
        assert.equal(
          (error as ConflictException).getStatus(),
          409,
          '23505 mismatch must be 409',
        );
        return true;
      },
    );
    assert.equal(enqueued, 0, '23505 mismatch must not enqueue');
  }

  {
    let enqueued = 0;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        create: async () => {
          const error = new Error('duplicate') as Error & { code?: string };
          error.code = '23505';
          throw error;
        },
        findOne: async () => ({
          id: 'race4',
          requestFingerprint: null,
          status: CheckStatus.PENDING,
        }),
        update: async () => {},
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
    });
    await (
      svc as unknown as {
        createCheckAndEnqueue: (
          k: string,
          d: unknown,
          c: unknown,
        ) => Promise<void>;
      }
    ).createCheckAndEnqueue(
      'tokenize-commodity',
      { id: 'race4' },
      { id: 'race4', requestFingerprint: fp, status: CheckStatus.PENDING },
    );
    assert.equal(enqueued, 1, '23505 legacy null PENDING must re-enqueue');

    let enqueuedDriver = 0;
    const svcDriver = makeService({
      checkDb: {
        exists: async () => true,
        create: async () => {
          const error = new Error('duplicate') as Error & {
            driverError?: { code?: string };
          };
          (error as unknown as { driverError: { code: string } }).driverError =
            { code: '23505' };
          throw error;
        },
        findOne: async () => ({
          id: 'race5',
          requestFingerprint: fp,
          status: CheckStatus.PENDING,
        }),
        update: async () => {},
      },
      queue: {
        enqueue: async () => {
          enqueuedDriver += 1;
        },
      },
    });
    await (
      svcDriver as unknown as {
        createCheckAndEnqueue: (
          k: string,
          d: unknown,
          c: unknown,
        ) => Promise<void>;
      }
    ).createCheckAndEnqueue(
      'tokenize-commodity',
      { id: 'race5' },
      { id: 'race5', requestFingerprint: fp, status: CheckStatus.PENDING },
    );
    assert.equal(
      enqueuedDriver,
      1,
      '23505 via driverError must also re-enqueue',
    );
  }
  {
    let providerCalls = 0;
    let deploymentCalls = 0;
    let enqueued = 0;
    const fp1 = deriveRequestFingerprint({ x: 1 });
    const fp2 = deriveRequestFingerprint({ x: 2 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'spend-mismatch',
          requestFingerprint: fp1,
          status: CheckStatus.PENDING,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
      provider: {
        fetchUTxOs: async () => {
          providerCalls += 1;
          return [{ output: { address: 'addr_test1xyz' } }];
        },
      },
      deploymentService: {
        getDeploymentByContractAddress: async () => {
          deploymentCalls += 1;
          return {
            deploymentTxHash: 'deplHash',
            deploymentOutputIndex: 0,
          };
        },
      },
    });
    await assert.rejects(
      async () =>
        svc.dispatchSpendCommodity(
          {
            id: 'spend-mismatch',
            utxos: [{ txHash: 'abc', outputIndex: 0 }],
            utxoRef: {},
          },
          fp2,
        ),
      (error: unknown) => {
        assert.ok(
          error instanceof ConflictException,
          'spend mismatch must throw ConflictException',
        );
        assert.equal(
          (error as ConflictException).getStatus(),
          409,
          'spend mismatch must be 409',
        );
        return true;
      },
    );
    assert.equal(
      providerCalls,
      0,
      'spend mismatch must not call provider.fetchUTxOs',
    );
    assert.equal(
      deploymentCalls,
      0,
      'spend mismatch must not call deployment lookup',
    );
    assert.equal(enqueued, 0, 'spend mismatch must not enqueue');
  }

  {
    let providerCalls = 0;
    let deploymentCalls = 0;
    let enqueued = 0;
    const fp1 = deriveRequestFingerprint({ x: 1 });
    const fp2 = deriveRequestFingerprint({ x: 2 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'recreate-mismatch',
          requestFingerprint: fp1,
          status: CheckStatus.PENDING,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
      provider: {
        fetchUTxOs: async () => {
          providerCalls += 1;
          return [{ output: { address: 'addr_test1xyz' } }];
        },
      },
      deploymentService: {
        getDeploymentByContractAddress: async () => {
          deploymentCalls += 1;
          return {
            deploymentTxHash: 'deplHash',
            deploymentOutputIndex: 0,
          };
        },
      },
    });
    await assert.rejects(
      async () =>
        svc.dispatchRecreateCommodity(
          {
            id: 'recreate-mismatch',
            utxos: [{ txHash: 'abc', outputIndex: 0 }],
            newDataReferences: ['cid1'],
            utxoRef: {},
          },
          fp2,
        ),
      (error: unknown) => {
        assert.ok(
          error instanceof ConflictException,
          'recreate mismatch must throw ConflictException',
        );
        assert.equal(
          (error as ConflictException).getStatus(),
          409,
          'recreate mismatch must be 409',
        );
        return true;
      },
    );
    assert.equal(
      providerCalls,
      0,
      'recreate mismatch must not call provider.fetchUTxOs',
    );
    assert.equal(
      deploymentCalls,
      0,
      'recreate mismatch must not call deployment lookup',
    );
    assert.equal(enqueued, 0, 'recreate mismatch must not enqueue');
  }

  {
    let providerCalls = 0;
    let deploymentCalls = 0;
    let enqueued = 0;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'spend-terminal',
          requestFingerprint: fp,
          status: CheckStatus.SUCCESS,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
      provider: {
        fetchUTxOs: async () => {
          providerCalls += 1;
          return [{ output: { address: 'addr_test1xyz' } }];
        },
      },
      deploymentService: {
        getDeploymentByContractAddress: async () => {
          deploymentCalls += 1;
          return {
            deploymentTxHash: 'deplHash',
            deploymentOutputIndex: 0,
          };
        },
      },
    });
    await svc.dispatchSpendCommodity(
      {
        id: 'spend-terminal',
        utxos: [{ txHash: 'abc', outputIndex: 0 }],
        utxoRef: {},
      },
      fp,
    );
    assert.equal(
      providerCalls,
      0,
      'spend terminal replay must not call provider.fetchUTxOs',
    );
    assert.equal(
      deploymentCalls,
      0,
      'spend terminal replay must not call deployment lookup',
    );
    assert.equal(enqueued, 0, 'spend terminal replay must not enqueue');
  }

  {
    let providerCalls = 0;
    let deploymentCalls = 0;
    let enqueued = 0;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'recreate-terminal',
          requestFingerprint: fp,
          status: CheckStatus.SUCCESS,
        }),
      },
      queue: {
        enqueue: async () => {
          enqueued += 1;
        },
      },
      provider: {
        fetchUTxOs: async () => {
          providerCalls += 1;
          return [{ output: { address: 'addr_test1xyz' } }];
        },
      },
      deploymentService: {
        getDeploymentByContractAddress: async () => {
          deploymentCalls += 1;
          return {
            deploymentTxHash: 'deplHash',
            deploymentOutputIndex: 0,
          };
        },
      },
    });
    await svc.dispatchRecreateCommodity(
      {
        id: 'recreate-terminal',
        utxos: [{ txHash: 'abc', outputIndex: 0 }],
        newDataReferences: ['cid1'],
        utxoRef: {},
      },
      fp,
    );
    assert.equal(
      providerCalls,
      0,
      'recreate terminal replay must not call provider.fetchUTxOs',
    );
    assert.equal(
      deploymentCalls,
      0,
      'recreate terminal replay must not call deployment lookup',
    );
    assert.equal(enqueued, 0, 'recreate terminal replay must not enqueue');
  }

  {
    let providerCalls = 0;
    let deploymentCalls = 0;
    let enqueued = 0;
    let enqueuedData: unknown = null;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'spend-pending',
          requestFingerprint: fp,
          status: CheckStatus.PENDING,
        }),
      },
      queue: {
        enqueue: async (_kind: unknown, data: unknown) => {
          enqueued += 1;
          enqueuedData = data;
        },
      },
      provider: {
        fetchUTxOs: async () => {
          providerCalls += 1;
          return [{ output: { address: 'addr_test1xyz' } }];
        },
      },
      deploymentService: {
        getDeploymentByContractAddress: async (addr: string) => {
          deploymentCalls += 1;
          assert.equal(
            addr,
            'addr_test1xyz',
            'deployment lookup must use address from fetched UTxO',
          );
          return {
            deploymentTxHash: 'deplHash',
            deploymentOutputIndex: 5,
          };
        },
      },
    });
    await svc.dispatchSpendCommodity(
      {
        id: 'spend-pending',
        utxos: [{ txHash: 'abc', outputIndex: 0 }],
        utxoRef: {},
      },
      fp,
    );
    assert.equal(
      providerCalls,
      1,
      'spend PENDING replay must resolve provider data',
    );
    assert.equal(
      deploymentCalls,
      1,
      'spend PENDING replay must resolve deployment',
    );
    assert.equal(enqueued, 1, 'spend PENDING replay must enqueue once');
    assert.deepEqual(
      (enqueuedData as { utxoRef: unknown }).utxoRef,
      {
        addr_test1xyz: {
          singletonScript: undefined,
          objectEventScript: { txHash: 'deplHash', outputIndex: 5 },
        },
      },
      'spend PENDING replay must enqueue enriched utxoRef',
    );
  }

  {
    let providerCalls = 0;
    let deploymentCalls = 0;
    let enqueued = 0;
    let enqueuedData: unknown = null;
    const fp = deriveRequestFingerprint({ x: 1 });
    const svc = makeService({
      checkDb: {
        exists: async () => true,
        findOne: async () => ({
          id: 'recreate-pending',
          requestFingerprint: fp,
          status: CheckStatus.PENDING,
        }),
      },
      queue: {
        enqueue: async (_kind: unknown, data: unknown) => {
          enqueued += 1;
          enqueuedData = data;
        },
      },
      provider: {
        fetchUTxOs: async () => {
          providerCalls += 1;
          return [{ output: { address: 'addr_test1xyz' } }];
        },
      },
      deploymentService: {
        getDeploymentByContractAddress: async (addr: string) => {
          deploymentCalls += 1;
          assert.equal(
            addr,
            'addr_test1xyz',
            'deployment lookup must use address from fetched UTxO',
          );
          return {
            deploymentTxHash: 'deplHash',
            deploymentOutputIndex: 7,
          };
        },
      },
    });
    await svc.dispatchRecreateCommodity(
      {
        id: 'recreate-pending',
        utxos: [{ txHash: 'abc', outputIndex: 0 }],
        newDataReferences: ['cid1'],
        utxoRef: {},
      },
      fp,
    );
    assert.equal(
      providerCalls,
      1,
      'recreate PENDING replay must resolve provider data',
    );
    assert.equal(
      deploymentCalls,
      1,
      'recreate PENDING replay must resolve deployment',
    );
    assert.equal(enqueued, 1, 'recreate PENDING replay must enqueue once');
    assert.deepEqual(
      (enqueuedData as { utxoRef: unknown }).utxoRef,
      {
        addr_test1xyz: {
          singletonScript: undefined,
          objectEventScript: { txHash: 'deplHash', outputIndex: 7 },
        },
      },
      'recreate PENDING replay must enqueue enriched utxoRef',
    );
  }

  console.log('idempotency check passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
