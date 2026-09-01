import 'reflect-metadata';
import assert from 'node:assert/strict';
import { BlockfrostServerError } from '@blockfrost/blockfrost-js';
import { resolvePlutusScriptHash, resolveTxHash } from '@meshsdk/core';
import { Check } from '../check/entities/check.entity';
import { DeploymentService } from '../deployment/deployment.service';
import { Deployment } from '../deployment/entities/deployment.entity';
import { tokenizeCommodityJob, UtxoQuery } from '../types/job.dto';
import { PalmyraConsumerService } from './palmyra.consumer.service';
import { openProofDatabase } from './proof-database';

type RawOutput = {
  tx_hash: string;
  output_index: number;
  reference_script_hash: string | null;
};
type RawMempoolTx = {
  tx: { hash: string };
  outputs: Array<{
    address: string;
    output_index: number;
    reference_script_hash: string | null;
  }>;
};
type ConsumerAccess = Record<string, unknown> & {
  enrichUtxoRef: (
    utxos: UtxoQuery[],
  ) => Promise<
    Record<
      string,
      { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
    >
  >;
  ensureDeployment: (
    data: tokenizeCommodityJob,
    mintTxid: string,
    signedTx: string,
  ) => Promise<void>;
};

const legacyAddress =
  'addr_test1wph2wcr4ysaen987g87magjh96l2ymvrgyvnu6yjvrtahdqu7qvqy';
const currentAddress =
  'addr_test1wpfc7e7zqlqtra8hnyq7k0hh3rdwjm7m0fnzuyqjl0xxt3gatmv8f';
const deployAddress = 'addr_test1_deployer';
const legacyTxHash = '1'.repeat(64);
const currentTxHash = '2'.repeat(64);
const discoveredTxHash = '3'.repeat(64);
const legacyScriptHash = resolvePlutusScriptHash(legacyAddress);
const currentScriptHash = resolvePlutusScriptHash(currentAddress);

function mempoolNotFound(): BlockfrostServerError {
  return new BlockfrostServerError({
    status_code: 404,
    error: 'Not Found',
    message: 'Mempool transaction not found',
    url: 'http://blockfrost.test/mempool/tx',
  });
}

function row(
  contractAddress: string,
  deploymentTxHash: string,
  deploymentOutputIndex: number,
  scriptHash: string | null,
): Deployment {
  return new Deployment({
    contractAddress,
    deployAddress,
    deploymentTxHash,
    deploymentOutputIndex,
    scriptHash,
  });
}

async function main(): Promise<void> {
  const proof = await openProofDatabase(
    [Deployment, Check],
    ['DEPLOYMENT_PROOF_DATABASE_URL'],
    'wt-deploy-proof',
  );
  const dataSource = proof.dataSource;
  try {
    const repository = dataSource.getRepository(Deployment);
    const outputs = new Map<string, RawOutput[]>();
    const mempool = new Map<string, RawMempoolTx | Error>();
    let rawCalls = 0;
    let mempoolCalls = 0;
    let saveCalls = 0;
    const service = Object.create(
      DeploymentService.prototype,
    ) as DeploymentService;
    Object.assign(service, {
      deploymentRepository: repository,
      entityManager: {
        save: async (deployment: Deployment) => {
          saveCalls += 1;
          return await dataSource.manager.save(deployment);
        },
      },
      blockfrost: {
        mempoolTx: async (txHash: string) => {
          mempoolCalls += 1;
          const result = mempool.get(txHash);
          if (!result) throw mempoolNotFound();
          if (result instanceof Error) throw result;
          return result;
        },
        addressesUtxosAll: async (address: string) => {
          rawCalls += 1;
          return outputs.get(address) ?? [];
        },
      },
    });
    await repository.save([
      row(legacyAddress, legacyTxHash, 0, null),
      row(currentAddress, currentTxHash, 1, currentScriptHash),
    ]);
    outputs.set(deployAddress, [
      {
        tx_hash: legacyTxHash,
        output_index: 0,
        reference_script_hash: legacyScriptHash,
      },
      {
        tx_hash: currentTxHash,
        output_index: 1,
        reference_script_hash: currentScriptHash,
      },
    ]);

    assert.equal(
      (await service.getLiveDeploymentByContractAddress(legacyAddress))
        .scriptHash,
      null,
    );
    assert.equal(
      (await service.getLiveDeploymentByContractAddress(currentAddress))
        .deploymentTxHash,
      currentTxHash,
    );

    const consumer = Object.create(
      PalmyraConsumerService.prototype,
    ) as ConsumerAccess;
    consumer['deploymentService'] = service;
    consumer['provider'] = {
      fetchUTxOs: async (txHash: string) => [
        {
          output: {
            address: txHash === legacyTxHash ? legacyAddress : currentAddress,
          },
        },
      ],
    };
    const refs = await consumer.enrichUtxoRef([
      { txHash: legacyTxHash, outputIndex: 7 },
      { txHash: currentTxHash, outputIndex: 8 },
    ]);
    assert.deepEqual(refs[legacyAddress]?.objectEventScript, {
      txHash: legacyTxHash,
      outputIndex: 0,
    });
    assert.deepEqual(refs[currentAddress]?.objectEventScript, {
      txHash: currentTxHash,
      outputIndex: 1,
    });

    outputs.set(deployAddress, [
      {
        tx_hash: discoveredTxHash,
        output_index: 2,
        reference_script_hash: currentScriptHash,
      },
    ]);
    const repaired =
      await service.getLiveDeploymentByContractAddress(currentAddress);
    assert.equal(repaired.deploymentTxHash, discoveredTxHash);
    assert.equal(repaired.deploymentOutputIndex, 2);
    assert.equal(repaired.scriptHash, currentScriptHash);
    assert.equal(saveCalls, 1);

    outputs.set(deployAddress, [
      {
        tx_hash: discoveredTxHash,
        output_index: 3,
        reference_script_hash: legacyScriptHash,
      },
    ]);
    await assert.rejects(
      service.getLiveDeploymentByContractAddress(legacyAddress),
      /Historical deployment unavailable/,
    );
    const legacy = await repository.findOneByOrFail({
      contractAddress: legacyAddress,
    });
    assert.equal(legacy.deploymentTxHash, legacyTxHash);
    assert.equal(legacy.scriptHash, null);
    const legacySaveCalls = saveCalls;
    let deploymentBuilds = 0;
    let deploymentSubmits = 0;
    consumer['deployerAddress'] = deployAddress;
    consumer['objectEventScriptHash'] = currentScriptHash;
    consumer['factory'] = {
      objectEventContractAddress: currentAddress,
      submitTx: async () => {
        deploymentSubmits += 1;
      },
    };
    consumer['getMintContext'] = async () => ({
      contractAddress: legacyAddress,
      utxoRef: { txHash: 'f'.repeat(64), outputIndex: 0 },
    });
    consumer['retryBuildTransaction'] = async () => {
      deploymentBuilds += 1;
      throw new Error('legacy deployment must not build');
    };
    const mintCbor = '84a10080a0f5f6';
    await assert.rejects(
      consumer.ensureDeployment(
        { id: 'legacy-mint' } as tokenizeCommodityJob,
        resolveTxHash(mintCbor),
        mintCbor,
      ),
      /Historical deployment unavailable/,
    );
    assert.equal(deploymentBuilds, 0);
    assert.equal(deploymentSubmits, 0);
    assert.equal(saveCalls, legacySaveCalls);

    consumer['getMintContext'] = async () => ({
      contractAddress: currentAddress,
      utxoRef: { txHash: 'e'.repeat(64), outputIndex: 0 },
    });
    consumer['retryBuildTransaction'] = async () => {
      deploymentBuilds += 1;
      throw new Error('duplicate reference deployment built');
    };
    outputs.set(deployAddress, []);
    mempool.set(discoveredTxHash, {
      tx: { hash: discoveredTxHash },
      outputs: [
        {
          address: deployAddress,
          output_index: 2,
          reference_script_hash: currentScriptHash,
        },
      ],
    });
    const pendingRow = await repository.findOneByOrFail({
      contractAddress: currentAddress,
    });
    const pendingIdentity = {
      deploymentTxHash: pendingRow.deploymentTxHash,
      deploymentOutputIndex: pendingRow.deploymentOutputIndex,
      deployAddress: pendingRow.deployAddress,
      scriptHash: pendingRow.scriptHash,
    };
    const pendingRawCalls = rawCalls;
    const pendingSaveCalls = saveCalls;
    await assert.rejects(
      consumer.ensureDeployment(
        { id: 'second-current-mint' } as tokenizeCommodityJob,
        resolveTxHash(mintCbor),
        mintCbor,
      ),
      /pending confirmation/,
    );
    assert.equal(deploymentBuilds, 0);
    assert.equal(deploymentSubmits, 0);
    assert.equal(saveCalls, pendingSaveCalls);
    assert.equal(rawCalls, pendingRawCalls);
    assert.equal(mempoolCalls, 1);
    assert.deepEqual(
      await repository.findOneByOrFail({ contractAddress: currentAddress }),
      pendingRow,
    );

    mempool.delete(discoveredTxHash);
    outputs.set(deployAddress, [
      {
        tx_hash: discoveredTxHash,
        output_index: 2,
        reference_script_hash: currentScriptHash,
      },
    ]);
    await consumer.ensureDeployment(
      { id: 'second-current-mint' } as tokenizeCommodityJob,
      resolveTxHash(mintCbor),
      mintCbor,
    );
    assert.equal(deploymentBuilds, 0);
    assert.equal(deploymentSubmits, 0);
    assert.equal(saveCalls, pendingSaveCalls);
    assert.equal(rawCalls, pendingRawCalls + 1);
    assert.equal(mempoolCalls, 2);
    const confirmedRow = await repository.findOneByOrFail({
      contractAddress: currentAddress,
    });
    assert.deepEqual(
      {
        deploymentTxHash: confirmedRow.deploymentTxHash,
        deploymentOutputIndex: confirmedRow.deploymentOutputIndex,
        deployAddress: confirmedRow.deployAddress,
        scriptHash: confirmedRow.scriptHash,
      },
      pendingIdentity,
    );

    const exactPending: RawMempoolTx = {
      tx: { hash: discoveredTxHash },
      outputs: [
        {
          address: deployAddress,
          output_index: 2,
          reference_script_hash: currentScriptHash,
        },
      ],
    };
    const invalidPending: RawMempoolTx[] = [
      { ...exactPending, tx: { hash: '4'.repeat(64) } },
      {
        ...exactPending,
        outputs: [{ ...exactPending.outputs[0], address: 'addr_test1_other' }],
      },
      {
        ...exactPending,
        outputs: [{ ...exactPending.outputs[0], output_index: 3 }],
      },
      {
        ...exactPending,
        outputs: [
          {
            ...exactPending.outputs[0],
            reference_script_hash: legacyScriptHash,
          },
        ],
      },
    ];
    const invalidRawCalls = rawCalls;
    for (const invalid of invalidPending) {
      mempool.set(discoveredTxHash, invalid);
      await assert.rejects(
        service.getCurrentReferenceState(currentAddress),
        /Pending deployment identity does not match/,
      );
    }
    assert.equal(rawCalls, invalidRawCalls);
    assert.equal(saveCalls, pendingSaveCalls);

    const mempoolProviderFailure = new Error('mempool provider unavailable');
    mempool.set(discoveredTxHash, mempoolProviderFailure);
    await assert.rejects(
      service.getCurrentReferenceState(currentAddress),
      (error: unknown) => error === mempoolProviderFailure,
    );
    const serverFailure = new BlockfrostServerError({
      status_code: 500,
      error: 'Internal Server Error',
      message: 'Mempool request failed',
      url: 'http://blockfrost.test/mempool/tx',
    });
    mempool.set(discoveredTxHash, serverFailure);
    await assert.rejects(
      service.getCurrentReferenceState(currentAddress),
      (error: unknown) => error === serverFailure,
    );
    assert.equal(rawCalls, invalidRawCalls);
    assert.equal(saveCalls, pendingSaveCalls);

    await repository.save(row(currentAddress, discoveredTxHash, 2, null));
    const legacyMempoolCalls = mempoolCalls;
    await assert.rejects(
      service.getCurrentReferenceState(currentAddress),
      /Historical deployment identity cannot become current/,
    );
    assert.equal(mempoolCalls, legacyMempoolCalls);
    assert.equal(rawCalls, invalidRawCalls);
    assert.equal(saveCalls, pendingSaveCalls);

    await repository.save(
      row(currentAddress, currentTxHash, 1, currentScriptHash),
    );
    mempool.delete(currentTxHash);
    outputs.set(deployAddress, [
      {
        tx_hash: discoveredTxHash,
        output_index: 2,
        reference_script_hash: currentScriptHash,
      },
    ]);
    const discoveryRawCalls = rawCalls;
    const discoverySaveCalls = saveCalls;
    await consumer.ensureDeployment(
      { id: 'stale-current-mint' } as tokenizeCommodityJob,
      resolveTxHash(mintCbor),
      mintCbor,
    );
    assert.equal(deploymentBuilds, 0);
    assert.equal(deploymentSubmits, 0);
    assert.equal(rawCalls, discoveryRawCalls + 2);
    assert.equal(saveCalls, discoverySaveCalls + 1);
    assert.equal(
      (await repository.findOneByOrFail({ contractAddress: currentAddress }))
        .deploymentTxHash,
      discoveredTxHash,
    );

    await repository.save(
      row(currentAddress, currentTxHash, 1, currentScriptHash),
    );
    outputs.set(deployAddress, []);
    const builtTxHash = '5'.repeat(64);
    const builtSignedTx = '84a0a0f5f6';
    let deploymentAttaches = 0;
    consumer['checkDb'] = {
      attachReferenceDeployment: async () => {
        deploymentAttaches += 1;
      },
    };
    consumer['retryBuildTransaction'] = async () => {
      deploymentBuilds += 1;
      return {
        deploymentTxHash: builtTxHash,
        signedTx: builtSignedTx,
        deploymentOutputIndex: 0,
      };
    };
    const buildSaveCalls = saveCalls;
    await consumer.ensureDeployment(
      { id: 'stale-build-mint' } as tokenizeCommodityJob,
      resolveTxHash(mintCbor),
      mintCbor,
    );
    assert.equal(deploymentBuilds, 1);
    assert.equal(deploymentSubmits, 1);
    assert.equal(deploymentAttaches, 1);
    assert.equal(saveCalls, buildSaveCalls + 1);
    assert.equal(
      (await repository.findOneByOrFail({ contractAddress: currentAddress }))
        .deploymentTxHash,
      builtTxHash,
    );

    outputs.set(deployAddress, [
      {
        tx_hash: currentTxHash,
        output_index: 1,
        reference_script_hash: legacyScriptHash,
      },
    ]);
    await assert.rejects(
      service.getLiveDeploymentByContractAddress(currentAddress),
      /Live deployment not found/,
    );

    const providerFailure = new Error('provider unavailable');
    Object.assign(service, {
      blockfrost: {
        addressesUtxosAll: async () => {
          rawCalls += 1;
          throw providerFailure;
        },
      },
    });
    const rawBefore = rawCalls;
    const savesBefore = saveCalls;
    await assert.rejects(
      service.getLiveDeploymentByContractAddress(currentAddress),
      (error: unknown) => error === providerFailure,
    );
    assert.equal(rawCalls, rawBefore + 1);
    assert.equal(saveCalls, savesBefore);
    await assert.rejects(
      consumer.enrichUtxoRef([{ txHash: currentTxHash, outputIndex: 1 }]),
      (error: unknown) => error === providerFailure,
    );
    assert.equal(rawCalls, rawBefore + 2);
    assert.equal(saveCalls, savesBefore);
    console.log('deployment routing check passed');
  } finally {
    await proof.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
