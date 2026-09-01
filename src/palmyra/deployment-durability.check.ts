import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CheckService } from '../check/check.service';
import { Check, CheckStatus, CheckType } from '../check/entities/check.entity';
import { tokenizeCommodityJob } from '../types/job.dto';
import { TokenizeCommodityDto } from './dto/tokenize-commodity.dto';
import { PalmyraConsumerService } from './palmyra.consumer.service';

const deploymentCbor = '84a0a0f5f6';
const deploymentTxid =
  'd36a2619a672494604e11bb447cbcf5231e9f2ba25c2169177edc941bd50ad6c';
const mintCbor = '84a10080a0f5f6';
const mintTxid =
  'fa130e633a87e57868fcd176bbe196cf8c6733d75d67239eca1d29746d1e3fc8';
type StoredDeployment = {
  signedTx: string;
  txid: string;
  outputIndex: number;
  contractAddress: string;
  deployAddress: string;
};

type ConsumerAccess = Record<string, unknown> & {
  ensureDeployment: (
    data: tokenizeCommodityJob,
    mintTxid: string,
    signedTx: string,
    storedDeployment?: StoredDeployment,
  ) => Promise<void>;
};

function composite(signedTx: string, deployment: StoredDeployment): string {
  return JSON.stringify({ signedTx, deployment });
}

function makeConsumer(args: {
  initialSignedTx: string;
  deployment: StoredDeployment;
  failDeploymentWrite?: boolean;
  live?: { txHash: string; outputIndex: number } | null;
  currentValidator?: boolean;
}): {
  consumer: ConsumerAccess;
  getStoredSignedTx: () => string;
  submitted: string[];
  getBuildCalls: () => number;
  getAttachCalls: () => number;
  saved: StoredDeployment[];
} {
  let storedSignedTx = args.initialSignedTx;
  let buildCalls = 0;
  let attachCalls = 0;
  const submitted: string[] = [];
  const saved: StoredDeployment[] = [];
  const consumer = Object.create(
    PalmyraConsumerService.prototype,
  ) as ConsumerAccess;
  consumer['checkDb'] = {
    attachReferenceDeployment: async (
      _id: string,
      _txid: string,
      currentSignedTx: string,
      compositeSignedTx: string,
    ) => {
      attachCalls += 1;
      if (storedSignedTx === compositeSignedTx) return;
      if (storedSignedTx !== currentSignedTx) {
        throw new Error('guarded deployment attachment refused');
      }
      storedSignedTx = compositeSignedTx;
    },
  };
  consumer['deploymentService'] = {
    getCurrentReferenceState: async () => 'none',
    findLiveReference: async () => args.live ?? null,
    getLiveDeploymentByContractAddress: async () => {
      throw new Error('Historical deployment identity is unavailable');
    },
  };
  consumer['deployerAddress'] = args.deployment.deployAddress;
  consumer['getMintContext'] = async () => ({
    contractAddress: args.deployment.contractAddress,
    utxoRef: { txHash: 'f'.repeat(64), outputIndex: 0 },
  });

  consumer['retryBuildTransaction'] = async () => {
    buildCalls += 1;
    return {
      deploymentTxHash: args.deployment.txid,
      signedTx: args.deployment.signedTx,
      deploymentOutputIndex: args.deployment.outputIndex,
    };
  };
  consumer['factory'] = {
    objectEventContractAddress:
      args.currentValidator === false
        ? 'addr_test1_current_contract'
        : args.deployment.contractAddress,
    submitTx: async (signedTx: string) => {
      assert.equal(
        storedSignedTx,
        composite(mintCbor, args.deployment),
        'deployment identity must be durable before submit',
      );
      submitted.push(signedTx);
      return args.deployment.txid;
    },
  };
  consumer['saveDeployment'] = async (deployment: StoredDeployment) => {
    if (args.failDeploymentWrite) throw new Error('worker cancelled');
    saved.push(deployment);
  };
  return {
    consumer,
    getStoredSignedTx: () => storedSignedTx,
    submitted,
    getBuildCalls: () => buildCalls,
    getAttachCalls: () => attachCalls,
    saved,
  };
}

async function checkCancellationAndRedelivery(): Promise<void> {
  const deployment: StoredDeployment = {
    signedTx: deploymentCbor,
    txid: deploymentTxid,
    outputIndex: 0,
    contractAddress: 'addr_test1_contract',
    deployAddress: 'addr_test1_deployer',
  };
  const job = { id: 'mint-id' } as tokenizeCommodityJob;
  const first = makeConsumer({
    initialSignedTx: mintCbor,
    deployment,
    failDeploymentWrite: true,
  });
  await assert.rejects(
    first.consumer.ensureDeployment(job, mintTxid, mintCbor),
    /worker cancelled/,
  );
  const storedComposite = composite(mintCbor, deployment);
  assert.equal(first.getStoredSignedTx(), storedComposite);
  assert.deepEqual(first.submitted, [deploymentCbor]);
  assert.equal(first.getBuildCalls(), 1);
  assert.equal(first.getAttachCalls(), 1);
  assert.deepEqual(first.saved, []);

  const redelivery = makeConsumer({
    initialSignedTx: storedComposite,
    deployment,
  });
  await redelivery.consumer.ensureDeployment(
    job,
    mintTxid,
    mintCbor,
    deployment,
  );
  assert.equal(redelivery.getBuildCalls(), 0, 'redelivery must not rebuild');
  assert.deepEqual(redelivery.submitted, [deploymentCbor]);
  assert.equal(redelivery.getStoredSignedTx(), storedComposite);
  assert.equal(redelivery.getAttachCalls(), 0);
  assert.deepEqual(redelivery.saved, [deployment]);

  const live = makeConsumer({
    initialSignedTx: mintCbor,
    deployment,
    live: { txHash: 'c'.repeat(64), outputIndex: 4 },
  });
  await live.consumer.ensureDeployment(job, mintTxid, mintCbor);
  assert.equal(live.getBuildCalls(), 0);
  assert.equal(live.getAttachCalls(), 0);
  assert.deepEqual(live.submitted, []);
  assert.deepEqual(live.saved, [
    {
      signedTx: '',
      txid: 'c'.repeat(64),
      outputIndex: 4,
      contractAddress: deployment.contractAddress,
      deployAddress: deployment.deployAddress,
    },
  ]);

  const invalidDeployments: StoredDeployment[] = [
    { ...deployment, contractAddress: 'addr_test1_other_contract' },
    { ...deployment, deployAddress: 'addr_test1_other_deployer' },
    { ...deployment, outputIndex: 1 },
    { ...deployment, outputIndex: Number.MAX_SAFE_INTEGER + 1 },
    { ...deployment, txid: 'e'.repeat(64) },
    { ...deployment, signedTx: mintCbor },
    { ...deployment, signedTx: 'not-cbor' },
  ];
  for (const invalid of invalidDeployments) {
    const rejected = makeConsumer({
      initialSignedTx: storedComposite,
      deployment,
    });
    await assert.rejects(
      rejected.consumer.ensureDeployment(job, mintTxid, mintCbor, invalid),
    );
    assert.equal(rejected.getBuildCalls(), 0);
    assert.equal(rejected.getAttachCalls(), 0);
    assert.deepEqual(rejected.submitted, []);
    assert.deepEqual(rejected.saved, []);
  }

  const invalidMint = makeConsumer({ initialSignedTx: mintCbor, deployment });
  await assert.rejects(
    invalidMint.consumer.ensureDeployment(job, '0'.repeat(64), mintCbor),
    /Stored mint transaction hash does not match its identity/,
  );
  assert.equal(invalidMint.getBuildCalls(), 0);
  assert.equal(invalidMint.getAttachCalls(), 0);
  assert.deepEqual(invalidMint.submitted, []);
  assert.deepEqual(invalidMint.saved, []);

  const legacy = makeConsumer({
    initialSignedTx: mintCbor,
    deployment,
    currentValidator: false,
  });
  await assert.rejects(
    legacy.consumer.ensureDeployment(job, mintTxid, mintCbor),
    /Historical deployment identity is unavailable/,
  );
  assert.equal(legacy.getBuildCalls(), 0);
  assert.equal(legacy.getAttachCalls(), 0);
  assert.deepEqual(legacy.submitted, []);
  assert.deepEqual(legacy.saved, []);
}

type GuardRow = {
  id: string;
  status: CheckStatus;
  txid: string;
  signedTx: string | null;
  error: string | null;
  confirmation: unknown | null;
};

function guardedCheckService(row: GuardRow): CheckService {
  const repository = {
    createQueryBuilder: () => {
      const clauses: Array<{
        sql: string;
        parameters: Record<string, unknown>;
      }> = [];
      let values: Partial<GuardRow> = {};
      const qb: Record<string, unknown> = {};
      qb['update'] = () => qb;
      qb['set'] = (next: Partial<GuardRow>) => {
        values = next;
        return qb;
      };
      qb['where'] = (sql: string, parameters: Record<string, unknown>) => {
        clauses.push({ sql, parameters });
        return qb;
      };
      qb['andWhere'] = (
        sql: string,
        parameters: Record<string, unknown> = {},
      ) => {
        clauses.push({ sql, parameters });
        return qb;
      };
      qb['execute'] = async () => {
        const matches = clauses.every(({ sql, parameters }) => {
          if (sql.includes('id =')) return row.id === parameters['id'];
          if (sql.includes('LOWER("txid")'))
            return (
              row.txid.toLowerCase() ===
              String(parameters['txid']).toLowerCase()
            );
          if (sql.includes('txid =')) return row.txid === parameters['txid'];
          if (sql.includes('"signedTx" ='))
            return row.signedTx === parameters['currentSignedTx'];
          if (sql.includes('"confirmation" IS NULL'))
            return row.confirmation === null;
          if (sql.includes('"status" IN'))
            return (parameters['allowed'] as CheckStatus[]).includes(
              row.status,
            );
          if (sql.includes('"status" ='))
            return row.status === parameters['status'];
          return false;
        });
        if (!matches) return { affected: 0 };
        Object.assign(row, values);
        return { affected: 1 };
      };
      return qb;
    },
    findOneBy: async ({ id }: { id: string }) =>
      id === row.id ? ({ ...row, type: CheckType.TOKENIZE } as Check) : null,
  } as unknown as Repository<Check>;
  return new CheckService(repository);
}

async function checkGuardedMismatch(): Promise<void> {
  const txid = 'a'.repeat(64);
  const target = composite('mint-cbor', {
    signedTx: deploymentCbor,
    txid: deploymentTxid,
    outputIndex: 0,
    contractAddress: 'addr_test1_contract',
    deployAddress: 'addr_test1_deployer',
  });
  for (const mismatch of [
    { txid: 'b'.repeat(64) },
    { signedTx: 'different-cbor' },
    { status: CheckStatus.PENDING },
    { status: CheckStatus.QUEUED },
    { status: CheckStatus.ERROR },
  ]) {
    const row: GuardRow = {
      id: 'mint-id',
      status: CheckStatus.SUBMITTED,
      txid,
      signedTx: 'mint-cbor',
      error: 'preserve-error',
      confirmation: null,
      ...mismatch,
    };
    const before = structuredClone(row);
    await assert.rejects(
      guardedCheckService(row).attachReferenceDeployment(
        row.id,
        txid,
        'mint-cbor',
        target,
      ),
      /deployment/i,
    );
    assert.deepEqual(row, before);
  }

  for (const status of [
    CheckStatus.SUBMITTED,
    CheckStatus.SUCCESS,
    CheckStatus.CONFIRMED,
  ]) {
    const confirmation = { txid, block: 'block-proof' };
    const row: GuardRow = {
      id: 'mint-id',
      status,
      txid,
      signedTx: 'mint-cbor',
      error: 'preserve-error',
      confirmation,
    };
    const unchanged = { ...structuredClone(row), signedTx: target };
    const service = guardedCheckService(row);
    await service.attachReferenceDeployment(row.id, txid, 'mint-cbor', target);
    assert.deepEqual(row, unchanged);
    await service.attachReferenceDeployment(row.id, txid, 'mint-cbor', target);
    assert.deepEqual(row, unchanged);
  }
}

async function checkTokenNameBoundary(): Promise<void> {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const metadata = {
    type: 'body' as const,
    metatype: TokenizeCommodityDto,
    data: '',
  };
  await assert.rejects(
    pipe.transform(
      { tokenName: '', metadataReference: 'ipfs://cid' },
      metadata,
    ),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
    'empty tokenName must return 400',
  );
  await pipe.transform(
    { tokenName: 'é'.repeat(16), metadataReference: 'ipfs://cid' },
    metadata,
  );
  await assert.rejects(
    pipe.transform(
      { tokenName: 'é'.repeat(17), metadataReference: 'ipfs://cid' },
      metadata,
    ),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
    'tokenName must use UTF-8 byte length',
  );
}

async function main(): Promise<void> {
  await checkCancellationAndRedelivery();
  await checkGuardedMismatch();
  await checkTokenNameBoundary();
  console.log('deployment durability check passed');
}

void main();
