import assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { getMetadataArgsStorage } from 'typeorm';
import type { UpdateCheckDto } from './dto/update-check.dto.js';
import {
  ChainConfirmation,
  Check,
  CheckStatus,
  TokenizeProvenance,
} from './entities/check.entity.js';
import { CheckService } from './check.service.js';

function checkEnum(): void {
  assert.equal(CheckStatus.PENDING, 'PENDING');
  assert.equal(CheckStatus.QUEUED, 'QUEUED');
  assert.equal(CheckStatus.SUBMITTED, 'SUBMITTED');
  assert.equal(CheckStatus.SUCCESS, 'SUCCESS');
  assert.equal(CheckStatus.CONFIRMED, 'CONFIRMED');
  assert.equal(CheckStatus.ERROR, 'ERROR');
  const values = Object.values(CheckStatus);
  assert.equal(values.length, 6, 'CheckStatus must have six literals');
  assert.ok(values.includes('SUBMITTED' as CheckStatus));
  assert.ok(values.includes('CONFIRMED' as CheckStatus));
}

function checkStructuralTypes(): void {
  const prov = new TokenizeProvenance();
  const conf = new ChainConfirmation();
  (prov as TokenizeProvenance).policyId = 'ab'.repeat(28);
  (prov as TokenizeProvenance).assetNameHex = '636f66666565';
  (prov as TokenizeProvenance).contractAddress =
    'addr_test1wpfc7e7zqlqtra8hnyq7k0hh3rdwjm7m0fnzuyqjl0xxt3gatmv8f';
  (prov as TokenizeProvenance).outputIndex = 2;
  (prov as TokenizeProvenance).cid = 'bafkreihash';
  (conf as ChainConfirmation).network = 'preview';
  (conf as ChainConfirmation).txid = 'a'.repeat(64);
  (conf as ChainConfirmation).blockHash = 'b'.repeat(64);
  (conf as ChainConfirmation).blockHeight = 100;
  (conf as ChainConfirmation).slot = 999;
  (conf as ChainConfirmation).depth = 15;
  (conf as ChainConfirmation).requiredDepth = 15;
  (conf as ChainConfirmation).confirmedAt = new Date().toISOString();
  (conf as ChainConfirmation).provenance = prov;
  assert.equal(conf.provenance?.policyId, prov.policyId);
  assert.equal(conf.txid, 'a'.repeat(64));
}

function checkEntityColumns(): void {
  const storage = getMetadataArgsStorage();
  const cols = storage.columns.filter((c) => c.target === Check);
  const confirmation = cols.find(
    (c) => (c.propertyName as string) === 'confirmation',
  );
  const lastCheck = cols.find(
    (c) => (c.propertyName as string) === 'lastChainCheckAt',
  );
  const statusCol = cols.find((c) => (c.propertyName as string) === 'status');
  assert.ok(confirmation, 'Check.confirmation column must exist');
  assert.deepEqual(
    (confirmation as unknown as { options: { type: unknown } }).options.type,
    'jsonb',
  );
  assert.equal(
    (confirmation as unknown as { options: { nullable: boolean } }).options
      .nullable,
    true,
    'confirmation must be nullable',
  );
  assert.ok(lastCheck, 'Check.lastChainCheckAt column must exist');
  assert.equal(
    (lastCheck as unknown as { options: { type: unknown } }).options.type,
    'timestamptz',
  );
  assert.equal(
    (lastCheck as unknown as { options: { nullable: boolean } }).options
      .nullable,
    true,
    'lastChainCheckAt must be nullable',
  );
  assert.ok(statusCol, 'Check.status column must exist');
}

function fakeRepo() {
  const store = new Map<string, Check>();
  let lastWhere: Record<string, unknown> | null = null;
  return {
    store,
    get lastWhere() {
      return lastWhere;
    },
    insert: async (entity: Check) => {
      store.set(entity.id, entity);
    },
    findOneBy: async ({ id }: { id: string }) => store.get(id) ?? null,
    countBy: async ({ id }: { id: string }) => (store.has(id) ? 1 : 0),
    find: async () => [...store.values()],
    createQueryBuilder: () => {
      throw new Error('query builder not needed for this check');
    },
    update: async (
      where: Record<string, unknown>,
      partial: Partial<Check>,
    ): Promise<{ affected: number }> => {
      lastWhere = where;
      const id = where.id as string;
      const row = store.get(id);
      if (!row) return { affected: 0 };
      const statusCond = where.status as unknown as
        | {
            type: string;
            value: unknown;
            child?: { type: string };
          }
        | undefined;
      if (statusCond) {
        const excluded = statusCond.value as unknown as string[];
        if (Array.isArray(excluded) && excluded.includes(row.status)) {
          return { affected: 0 };
        }
        if (
          statusCond.type === 'not' &&
          Array.isArray(statusCond.value) === false
        ) {
          const inner = statusCond.value as unknown as { value: string[] };
          if (inner && Array.isArray(inner.value)) {
            if (inner.value.includes(row.status)) return { affected: 0 };
          }
        }
      }
      Object.assign(row, partial);
      store.set(id, row);
      return { affected: 1 };
    },
  };
}

async function checkGenericUpdateGuards(): Promise<void> {
  const repo = fakeRepo() as unknown as import('typeorm').Repository<Check>;
  const service = new CheckService(repo);
  const submitted = new Check({
    id: 'submitted-1',
    status: CheckStatus.SUBMITTED,
    txid: 'a'.repeat(64),
    confirmation: null,
    lastChainCheckAt: null,
  } as Partial<Check>);
  const confirmed = new Check({
    id: 'confirmed-1',
    status: CheckStatus.CONFIRMED,
    txid: 'b'.repeat(64),
    confirmation: {
      network: 'preview',
      txid: 'b'.repeat(64),
      blockHash: 'c'.repeat(64),
      blockHeight: 10,
      slot: 1,
      depth: 15,
      requiredDepth: 15,
      confirmedAt: new Date().toISOString(),
      provenance: null,
    } as ChainConfirmation,
    lastChainCheckAt: new Date(),
  } as Partial<Check>);
  const pending = new Check({
    id: 'pending-1',
    status: CheckStatus.PENDING,
    txid: null as unknown as string,
  } as unknown as Partial<Check>);
  (repo as unknown as { store: Map<string, Check> }).store.set(
    submitted.id,
    submitted,
  );
  (repo as unknown as { store: Map<string, Check> }).store.set(
    confirmed.id,
    confirmed,
  );
  (repo as unknown as { store: Map<string, Check> }).store.set(
    pending.id,
    pending,
  );
  await service.update(submitted.id, {
    status: CheckStatus.ERROR,
    error: 'boom',
  } as unknown as UpdateCheckDto);
  assert.equal(
    (repo as unknown as { store: Map<string, Check> }).store.get(submitted.id)
      ?.status,
    CheckStatus.SUBMITTED,
    'SUBMITTED must not be downgraded by generic update',
  );
  const submittedAfter = (
    repo as unknown as { store: Map<string, Check> }
  ).store.get(submitted.id);
  assert.equal(
    submittedAfter?.confirmation,
    null,
    'SUBMITTED confirmation must remain untouched',
  );
  await service.update(confirmed.id, {
    status: CheckStatus.ERROR,
    error: 'boom',
  } as unknown as UpdateCheckDto);
  assert.equal(
    (repo as unknown as { store: Map<string, Check> }).store.get(confirmed.id)
      ?.status,
    CheckStatus.CONFIRMED,
    'CONFIRMED must not be downgraded by generic update',
  );
  const confirmedAfter = (
    repo as unknown as { store: Map<string, Check> }
  ).store.get(confirmed.id);
  assert.ok(
    confirmedAfter?.confirmation,
    'CONFIRMED evidence must remain readable after rollback',
  );
  assert.equal(
    confirmedAfter?.confirmation?.txid,
    'b'.repeat(64),
    'CONFIRMED txid must remain',
  );
  await assert.rejects(
    () =>
      service.update(pending.id, {
        confirmation: { txid: 'a'.repeat(64) },
      } as unknown as UpdateCheckDto),
    (e: unknown) => {
      assert.ok(e instanceof BadRequestException);
      return true;
    },
  );
  await assert.rejects(
    () =>
      service.update(pending.id, {
        status: CheckStatus.SUBMITTED,
      } as unknown as UpdateCheckDto),
    (e: unknown) => {
      assert.ok(e instanceof BadRequestException);
      return true;
    },
  );
  await assert.rejects(
    () =>
      service.update(pending.id, {
        status: CheckStatus.CONFIRMED,
      } as unknown as UpdateCheckDto),
    (e: unknown) => {
      assert.ok(e instanceof BadRequestException);
      return true;
    },
  );
  await service.update(pending.id, {
    status: CheckStatus.QUEUED,
  } as unknown as UpdateCheckDto);
  assert.equal(
    (repo as unknown as { store: Map<string, Check> }).store.get(pending.id)
      ?.status,
    CheckStatus.QUEUED,
    'PENDING to QUEUED must still work',
  );
  const success = new Check({
    id: 'success-1',
    status: CheckStatus.SUCCESS,
    txid: 'd'.repeat(64),
  } as Partial<Check>);
  (repo as unknown as { store: Map<string, Check> }).store.set(
    success.id,
    success,
  );
  await service.update(success.id, {
    status: CheckStatus.ERROR,
    error: 'late error',
  } as unknown as UpdateCheckDto);
  assert.equal(
    (repo as unknown as { store: Map<string, Check> }).store.get(success.id)
      ?.status,
    CheckStatus.SUCCESS,
    'SUCCESS must not be downgraded by generic update',
  );
}

async function main(): Promise<void> {
  checkEnum();
  checkStructuralTypes();
  checkEntityColumns();
  await checkGenericUpdateGuards();
  console.log('rollback check passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
