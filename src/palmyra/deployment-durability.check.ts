import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CheckService } from '../check/check.service';
import { Check, CheckStatus, CheckType } from '../check/entities/check.entity';
import { tokenizeCommodityJob } from '../types/job.dto';
import { TokenizeCommodityDto } from './dto/tokenize-commodity.dto';
import { PalmyraConsumerService } from './palmyra.consumer.service';

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
}): {
  consumer: ConsumerAccess;
  getStoredSignedTx: () => string;
  submitted: string[];
  getBuildCalls: () => number;
} {
  let storedSignedTx = args.initialSignedTx;
  let buildCalls = 0;
  const submitted: string[] = [];
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
      if (storedSignedTx === compositeSignedTx) return;
      if (storedSignedTx !== currentSignedTx) {
        throw new Error('guarded deployment attachment refused');
      }
      storedSignedTx = compositeSignedTx;
    },
  };
  consumer['deploymentService'] = {
    deploymentExistsByContractAddress: async () => false,
  };
  consumer['deployerAddress'] = args.deployment.deployAddress;
  consumer['getMintContext'] = async () => ({
    contractAddress: args.deployment.contractAddress,
    utxoRef: { txHash: 'f'.repeat(64), outputIndex: 0 },
  });
  consumer['findOnChainDeployment'] = async () => null;
  consumer['retryBuildTransaction'] = async () => {
    buildCalls += 1;
    return {
      deploymentTxHash: args.deployment.txid,
      signedTx: args.deployment.signedTx,
      deploymentOutputIndex: args.deployment.outputIndex,
    };
  };
  consumer['factory'] = {
    submitTx: async (signedTx: string) => {
      assert.equal(
        storedSignedTx,
        composite('mint-cbor', args.deployment),
        'deployment identity must be durable before submit',
      );
      submitted.push(signedTx);
      return args.deployment.txid;
    },
  };
  consumer['saveDeployment'] = async () => {
    if (args.failDeploymentWrite) throw new Error('worker cancelled');
  };
  return {
    consumer,
    getStoredSignedTx: () => storedSignedTx,
    submitted,
    getBuildCalls: () => buildCalls,
  };
}

async function checkCancellationAndRedelivery(): Promise<void> {
  const deployment: StoredDeployment = {
    signedTx: 'deployment-cbor',
    txid: 'd'.repeat(64),
    outputIndex: 1,
    contractAddress: 'addr_test1_contract',
    deployAddress: 'addr_test1_deployer',
  };
  const job = { id: 'mint-id' } as tokenizeCommodityJob;
  const first = makeConsumer({
    initialSignedTx: 'mint-cbor',
    deployment,
    failDeploymentWrite: true,
  });
  await assert.rejects(
    first.consumer.ensureDeployment(job, 'a'.repeat(64), 'mint-cbor'),
    /worker cancelled/,
  );
  const storedComposite = composite('mint-cbor', deployment);
  assert.equal(first.getStoredSignedTx(), storedComposite);
  assert.deepEqual(first.submitted, ['deployment-cbor']);
  assert.equal(first.getBuildCalls(), 1);

  const redelivery = makeConsumer({
    initialSignedTx: storedComposite,
    deployment,
  });
  await redelivery.consumer.ensureDeployment(
    job,
    'a'.repeat(64),
    'mint-cbor',
    deployment,
  );
  assert.equal(redelivery.getBuildCalls(), 0, 'redelivery must not rebuild');
  assert.deepEqual(redelivery.submitted, ['deployment-cbor']);
  assert.equal(redelivery.getStoredSignedTx(), storedComposite);
}

type GuardRow = {
  id: string;
  status: CheckStatus;
  txid: string;
  signedTx: string | null;
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
          if (sql.includes('LOWER(check.txid)'))
            return (
              row.txid.toLowerCase() ===
              String(parameters['txid']).toLowerCase()
            );
          if (sql.includes('txid =')) return row.txid === parameters['txid'];
          if (sql.includes('signedTx ='))
            return row.signedTx === parameters['currentSignedTx'];
          if (sql.includes('confirmation IS NULL'))
            return row.confirmation === null;
          if (sql.includes('status ='))
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
    signedTx: 'deployment-cbor',
    txid: 'd'.repeat(64),
    outputIndex: 1,
    contractAddress: 'addr_test1_contract',
    deployAddress: 'addr_test1_deployer',
  });
  for (const mismatch of [
    { txid: 'b'.repeat(64) },
    { signedTx: 'different-cbor' },
    { status: CheckStatus.ERROR },
    { confirmation: { txid } },
  ]) {
    const row: GuardRow = {
      id: 'mint-id',
      status: CheckStatus.SUBMITTED,
      txid,
      signedTx: 'mint-cbor',
      confirmation: null,
      ...mismatch,
    };
    await assert.rejects(
      guardedCheckService(row).attachReferenceDeployment(
        row.id,
        txid,
        'mint-cbor',
        target,
      ),
      /deployment/i,
    );
    assert.notEqual(row.signedTx, target);
  }

  const row: GuardRow = {
    id: 'mint-id',
    status: CheckStatus.SUBMITTED,
    txid,
    signedTx: 'mint-cbor',
    confirmation: null,
  };
  const service = guardedCheckService(row);
  await service.attachReferenceDeployment(row.id, txid, 'mint-cbor', target);
  assert.equal(row.signedTx, target);
  await service.attachReferenceDeployment(row.id, txid, 'mint-cbor', target);
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
