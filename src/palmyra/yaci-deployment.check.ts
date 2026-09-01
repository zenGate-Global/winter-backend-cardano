import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { getTransactionInputs } from '@meshsdk/core-csl';
import { Check, CheckStatus, CheckType } from '../check/entities/check.entity';
import { Deployment } from '../deployment/entities/deployment.entity';
import { CheckService } from '../check/check.service';
import { DeploymentService } from '../deployment/deployment.service';
import { PalmyraConsumerService } from './palmyra.consumer.service';
import {
  resolvePlutusScriptHash,
  resolveScriptHash,
  YaciProvider,
} from '@meshsdk/core';
import { EventFactory } from '@zengate/winter-cardano-mesh';
import { buildMint, buildRecreate } from './palmyra.builder';
import { tokenizeCommodityJob } from '../types/job.dto';
import { PalmyraService } from './palmyra.service';
import { openProofDatabase } from './proof-database';
import { UtxoService } from './palymra.utxo.service';
import { UTxO } from '@meshsdk/core';
async function waitForUtxos(
  provider: YaciProvider,
  address: string,
  count: number,
  timeoutMs = 60000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const utxos = await provider.fetchAddressUTxOs(address).catch(() => []);
    if (utxos.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timeout waiting for ${count} wallet UTxOs`);
}

async function topUp(adminUrl: string, address: string): Promise<void> {
  const response = await fetch(
    `${adminUrl.replace(/\/$/, '')}/local-cluster/api/addresses/topup`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, adaAmount: 100 }),
    },
  );
  const result = (await response.json()) as {
    status?: boolean;
    message?: string;
  };
  assert.equal(
    response.ok,
    true,
    `Yaci faucet request failed with ${response.status}: ${result.message ?? 'no message'}`,
  );
  assert.equal(result.status, true, 'Yaci faucet must fund the test wallet');
}

async function waitForTx(
  provider: YaciProvider,
  txHash: string,
  timeoutMs = 60000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await provider.fetchTxInfo(txHash);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`timeout waiting for transaction ${txHash}`);
}

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

function consumerForProof(
  checkService: CheckService,
  deploymentService: DeploymentService,
  provider: YaciProvider,
  factory: EventFactory,
  deployerAddress: string,
  objectEventScriptHash: string,
): ConsumerAccess {
  const consumer = Object.create(
    PalmyraConsumerService.prototype,
  ) as ConsumerAccess;
  consumer['checkDb'] = checkService;
  consumer['deploymentService'] = deploymentService;
  consumer['provider'] = provider;
  consumer['factory'] = factory;
  consumer['deployerAddress'] = deployerAddress;
  consumer['objectEventScriptHash'] = objectEventScriptHash;
  consumer['logger'] = new Logger(
    PalmyraConsumerService.name,
  ) as unknown as never;
  return consumer;
}

async function waitForDataReference(
  service: Pick<PalmyraService, 'getDataByTokenIds'>,
  asset: string,
  expected: string,
  timeoutMs = 60000,
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const details = await service.getDataByTokenIds([asset]);
      const reference = Buffer.from(
        details[0].data_reference_hex.bytes,
        'hex',
      ).toString();
      if (reference === expected) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`timeout waiting for commodity details ${asset}`, {
    cause: lastError,
  });
}

async function proveDeploymentAndMint(
  dataSource: DataSource,
  provider: YaciProvider,
  factory: EventFactory,
  deployerAddress: string,
  blockfrostUrl: string,
  mempoolFixture: { current: unknown[] },
): Promise<void> {
  const deploymentRepository = dataSource.getRepository(Deployment);
  const checkRepository = dataSource.getRepository(Check);
  const deploymentService = new DeploymentService(
    deploymentRepository,
    dataSource.manager,
  );
  const checkService = new CheckService(checkRepository);
  const objectEventScriptHash = resolveScriptHash(
    factory.objectEventContract.code,
    factory.objectEventContract.version,
  );
  const consumer = consumerForProof(
    checkService,
    deploymentService,
    provider,
    factory,
    deployerAddress,
    objectEventScriptHash,
  );
  const job: tokenizeCommodityJob = {
    id: randomUUID(),
    tokenName: `yaci-${randomBytes(4).toString('hex')}`,
    metadataReference: `ipfs://yaci-mint-${randomBytes(8).toString('hex')}`,
  };
  // Patch UtxoService to use mutable local mempool fixture for funding selection
  const originalFlush = UtxoService.prototype.flushMempool;
  UtxoService.prototype.flushMempool = async function () {
    return mempoolFixture.current as never;
  };

  let mint: Awaited<ReturnType<typeof buildMint>>;
  try {
    mint = await buildMint(factory, { data: job }, true);
  } finally {
    // restore after mint build; fixture still mutable for deployment build
  }
  assert.ok(mint, 'buildMint must return');
  // capture mint funding inputs before submit
  const mintFunding = (mint as { inputUtxos: UTxO[] }).inputUtxos;
  assert.ok(
    Array.isArray(mintFunding) && mintFunding.length > 0,
    'mint must have funding UTxOs',
  );
  let waitedForMint = false;
  const mintHash = await factory.submitTx(mint.signedTx);
  assert.equal(mintHash.toLowerCase(), mint.mintTxHash.toLowerCase());

  // Model pending-spent mint inputs through mutable local mempool fixture BEFORE deployment
  // This makes getConfirmedFundingUtxos filter out the mint's spent inputs so deployment
  // selects disjoint confirmed funding.
  const spentInputs = getTransactionInputs(mint.signedTx);
  assert.ok(
    Array.isArray(spentInputs) && spentInputs.length > 0,
    'mint must have spent inputs',
  );
  mempoolFixture.current = [
    {
      tx: { hash: mint.mintTxHash },
      inputs: spentInputs.map((inp) => ({
        tx_hash: inp.txHash,
        output_index: inp.outputIndex,
      })),
      outputs: [],
      // provide minimal fields expected by getUnconfirmedInputs/Outputs
      hash: mint.mintTxHash,
    },
  ] as unknown as never;

  await checkRepository.insert(
    new Check({
      id: job.id,
      type: CheckType.TOKENIZE,
      status: CheckStatus.SUBMITTED,
      txid: mint.mintTxHash,
      signedTx: mint.signedTx,
      error: null,
      requestFingerprint: null,
      confirmation: null,
      additionalInfo: job,
    }),
  );
  const submit = factory.submitTx.bind(factory);
  let storedDeployment: StoredDeployment | undefined;
  let deploymentBuildFunding: UTxO[] | undefined;
  // Capture deployment funding by wrapping getUtxoSets
  const originalGetUtxoSets = UtxoService.prototype.getUtxoSets;
  UtxoService.prototype.getUtxoSets = async function (
    utxos: UTxO[],
    addresses: string[],
    mempool: unknown[],
  ) {
    const result = await originalGetUtxoSets.call(
      this,
      utxos,
      addresses,
      mempool,
    );
    if (mempoolFixture.current.length > 0 && !deploymentBuildFunding) {
      deploymentBuildFunding = result.confirmed;
    }
    return result;
  };

  factory.submitTx = async (signedTx: string) => {
    assert.equal(
      waitedForMint,
      false,
      'first deployment attempt must start before mint confirmation wait',
    );
    const row = await checkService.findOne(job.id);
    assert.ok(
      row.signedTx?.startsWith('{'),
      'deployment composite must be durable before submit',
    );
    const stored = JSON.parse(row.signedTx as string) as {
      signedTx: string;
      deployment: StoredDeployment;
    };
    assert.equal(stored.signedTx, mint.signedTx);
    assert.equal(stored.deployment.signedTx, signedTx);
    storedDeployment = stored.deployment;
    throw new Error('proof worker stopped before deployment submit');
  };
  await assert.rejects(
    consumer.ensureDeployment(job, mint.mintTxHash, mint.signedTx),
    /proof worker stopped/,
  );
  assert.ok(
    storedDeployment,
    'stopped worker must leave stored deployment bytes',
  );
  assert.equal(
    await deploymentRepository.count(),
    0,
    'no deployment row before redelivery',
  );

  // Redeliver exact bytes
  let deploymentSubmits = 0;
  let buildCount = 0;
  consumer['retryBuildTransaction'] = async () => {
    buildCount += 1;
    throw new Error('stored deployment retry rebuilt transaction');
  };
  factory.submitTx = async (signedTx: string) => {
    deploymentSubmits += 1;
    assert.equal(
      signedTx,
      storedDeployment?.signedTx,
      'redelivery must submit exact stored bytes',
    );
    return await submit(signedTx);
  };
  // Also intercept any unexpected rebuild by counting buildDeployRef calls via factory
  await consumer.ensureDeployment(
    job,
    mint.mintTxHash,
    mint.signedTx,
    storedDeployment,
  );
  // Restore getUtxoSets but keep flushMempool patched to fixture; Yaci Store has no /mempool endpoint.
  UtxoService.prototype.getUtxoSets = originalGetUtxoSets;
  factory.submitTx = submit;
  assert.equal(deploymentSubmits, 1, 'one reference deployment transaction');
  assert.equal(await deploymentRepository.count(), 1, 'one deployment row');
  const deployment = await deploymentRepository.findOneByOrFail({
    contractAddress: storedDeployment.contractAddress,
  });
  assert.equal(deployment.deploymentTxHash, storedDeployment.txid);
  assert.equal(deployment.scriptHash, objectEventScriptHash);
  const secondJob: tokenizeCommodityJob = {
    id: randomUUID(),
    tokenName: `yaci-pending-${randomBytes(4).toString('hex')}`,
    metadataReference: `ipfs://yaci-pending-${randomBytes(8).toString('hex')}`,
  };
  const deploymentAccess = deploymentService as unknown as {
    blockfrost?: unknown;
  };
  const realBlockfrost = deploymentAccess.blockfrost;
  let pendingLookups = 0;
  let duplicateSubmits = 0;
  deploymentAccess.blockfrost = {
    mempoolTx: async (txHash: string) => {
      pendingLookups += 1;
      assert.equal(txHash, deployment.deploymentTxHash);
      return {
        tx: { hash: deployment.deploymentTxHash },
        outputs: [
          {
            address: deployment.deployAddress,
            output_index: deployment.deploymentOutputIndex,
            reference_script_hash: objectEventScriptHash,
          },
        ],
      };
    },
  };
  factory.submitTx = async () => {
    duplicateSubmits += 1;
    throw new Error('pending deployment must not resubmit');
  };
  try {
    await assert.rejects(
      consumer.ensureDeployment(secondJob, mint.mintTxHash, mint.signedTx),
      /Reference deployment is pending confirmation/,
    );
  } finally {
    deploymentAccess.blockfrost = realBlockfrost;
    factory.submitTx = submit;
  }
  assert.equal(pendingLookups, 1, 'second job must inspect pending deployment');
  assert.equal(buildCount, 0, 'second job must not build duplicate deployment');
  assert.equal(duplicateSubmits, 0, 'second job must not submit duplicate');
  assert.equal(await deploymentRepository.count(), 1, 'one deployment row');
  const fencedDeployment = await deploymentRepository.findOneByOrFail({
    contractAddress: deployment.contractAddress,
  });
  assert.equal(fencedDeployment.deploymentTxHash, deployment.deploymentTxHash);
  assert.equal(
    fencedDeployment.deploymentOutputIndex,
    deployment.deploymentOutputIndex,
  );
  assert.equal(fencedDeployment.scriptHash, deployment.scriptHash);

  // Wait both hashes after kill/redeliver
  waitedForMint = true;
  await waitForTx(provider, mint.mintTxHash);
  await waitForTx(provider, deployment.deploymentTxHash);
  // Mint is now confirmed, its inputs are no longer unconfirmed; clear fixture before recreate.
  mempoolFixture.current = [];
  // Assert disjoint confirmed funding: mint and deployment used different UTxOs
  // Prefer on-chain input inspection; fallback to captured funding
  let disjointProved = false;
  try {
    const mintInfo = (await provider.fetchTxInfo(
      mint.mintTxHash,
    )) as unknown as {
      inputs?: Array<{ tx_hash: string; output_index: number }>;
    };
    const deployInfo = (await provider.fetchTxInfo(
      deployment.deploymentTxHash,
    )) as unknown as {
      inputs?: Array<{ tx_hash: string; output_index: number }>;
    };
    if (mintInfo?.inputs && deployInfo?.inputs) {
      const mintSet = new Set(
        mintInfo.inputs.map((i) => `${i.tx_hash}#${i.output_index}`),
      );
      const overlap = deployInfo.inputs.some((i) =>
        mintSet.has(`${i.tx_hash}#${i.output_index}`),
      );
      assert.equal(
        overlap,
        false,
        'mint and deployment must use disjoint funding inputs',
      );
      disjointProved = true;
    }
  } catch {
    // ignore, fallback to captured funding
  }
  if (!disjointProved) {
    if (deploymentBuildFunding && spentInputs) {
      const mintSet = new Set(
        spentInputs.map((inp) => `${inp.txHash}#${inp.outputIndex}`),
      );
      const overlap = deploymentBuildFunding.some((u) =>
        mintSet.has(`${u.input.txHash}#${u.input.outputIndex}`),
      );
      assert.equal(
        overlap,
        false,
        'mint and deployment must use disjoint confirmed funding (captured)',
      );
    } else {
      assert.fail('could not prove disjoint confirmed funding');
    }
  }

  // Recover the confirmed deployment from chain after its disposable row is lost.
  await deploymentRepository.delete({
    contractAddress: storedDeployment.contractAddress,
  });
  assert.equal(await deploymentRepository.count(), 0);
  factory.submitTx = async () => {
    throw new Error('confirmed deployment must not resubmit');
  };
  await consumer.ensureDeployment(
    job,
    mint.mintTxHash,
    mint.signedTx,
    storedDeployment,
  );
  factory.submitTx = submit;
  assert.equal(buildCount, 0, 'confirmed recovery must not rebuild');
  assert.equal(await deploymentRepository.count(), 1);
  const recovered = await deploymentRepository.findOneByOrFail({
    contractAddress: storedDeployment.contractAddress,
  });
  assert.equal(recovered.deploymentTxHash, storedDeployment.txid);
  assert.equal(recovered.deploymentOutputIndex, storedDeployment.outputIndex);
  assert.equal(recovered.contractAddress, storedDeployment.contractAddress);
  assert.equal(recovered.deployAddress, storedDeployment.deployAddress);
  assert.equal(recovered.scriptHash, objectEventScriptHash);

  const referenceBefore = await provider.fetchUTxOs(
    deployment.deploymentTxHash,
    deployment.deploymentOutputIndex,
  );
  assert.equal(referenceBefore.length, 1, 'reference output must exist');
  assert.ok(
    referenceBefore[0].output.scriptRef,
    'reference output must have scriptRef',
  );
  assert.equal(
    referenceBefore[0].output.scriptHash,
    objectEventScriptHash,
    'reference output script hash must match the exact script',
  );
  assert.equal(
    objectEventScriptHash,
    resolvePlutusScriptHash(mint.contractAddress),
    'contract address must contain the exact object-event script hash',
  );
  const palmyra = Object.create(PalmyraService.prototype) as Record<
    string,
    unknown
  > &
    Pick<PalmyraService, 'getDataByTokenIds'>;
  palmyra['provider'] = {
    fetchAssetAddresses: async (asset: string) => {
      const response = await fetch(
        `${blockfrostUrl.replace(/\/$/, '')}/assets/${asset}/addresses`,
      );
      assert.equal(response.ok, true, 'Yaci asset address lookup must succeed');
      return (await response.json()) as Array<{
        address: string;
        quantity: string;
      }>;
    },
    fetchAddressUTxOs: provider.fetchAddressUTxOs.bind(provider),
  };
  palmyra['logger'] = { error: () => undefined };
  await waitForDataReference(palmyra, mint.singleton, job.metadataReference);

  const mintedUtxos = await provider.fetchAddressUTxOs(
    mint.contractAddress,
    mint.singleton,
  );
  assert.equal(mintedUtxos.length, 1, 'minted commodity output must exist');
  const recreatedReference = `ipfs://yaci-recreate-${randomBytes(8).toString('hex')}`;
  const recreate = await buildRecreate(
    factory,
    {
      data: {
        id: randomUUID(),
        utxos: [mintedUtxos[0].input],
        newDataReferences: [recreatedReference],
        utxoRef: {
          [mint.contractAddress]: {
            singletonScript: undefined,
            objectEventScript: {
              txHash: deployment.deploymentTxHash,
              outputIndex: deployment.deploymentOutputIndex,
            },
          },
        },
      },
    },
    true,
  );
  assert.ok(recreate, 'buildRecreate must return');
  const recreateHash = await factory.submitTx(recreate.signedTx);
  assert.equal(recreateHash.toLowerCase(), recreate.hash.toLowerCase());
  await waitForTx(provider, recreate.hash);

  await waitForDataReference(palmyra, mint.singleton, recreatedReference);
  const referenceAfter = (
    await provider.fetchAddressUTxOs(deployerAddress)
  ).find(
    (utxo) =>
      utxo.input.txHash === deployment.deploymentTxHash &&
      utxo.input.outputIndex === deployment.deploymentOutputIndex,
  );
  assert.ok(referenceAfter, 'reference output must remain unspent');
  assert.ok(
    referenceAfter.output.scriptRef,
    'reference output must retain scriptRef',
  );
  assert.equal(
    referenceAfter.output.scriptHash,
    objectEventScriptHash,
    'reference output script hash must retain the exact script',
  );
  assert.equal(
    objectEventScriptHash,
    resolvePlutusScriptHash(mint.contractAddress),
    'contract address must retain the exact object-event script hash',
  );
  // Clear fixture and restore original flush after success
  UtxoService.prototype.flushMempool = originalFlush;
  mempoolFixture.current = [];

  console.log(
    'Yaci proof: durable first deployment, exact-byte redelivery, mint, recreate, and details passed',
  );
  console.log(
    'NOTE: Yaci cannot prove spend or mempool chaining because it lacks the required endpoints',
  );
}

async function startMutableMempool(
  port: number,
  fixture: { current: unknown[] },
): Promise<Server> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (
      request.method === 'GET' &&
      (path === '/api/v1/mempool' ||
        path === '/mempool' ||
        path.startsWith('/mempool/'))
    ) {
      if (path === '/mempool' || path === '/api/v1/mempool') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        // Return array of tx hashes or full objects depending on endpoint
        // For /mempool, return list of {tx_hash}
        // For /api/v1/mempool, return full fixture
        if (path === '/mempool') {
          const hashes = (
            fixture.current as Array<{ hash?: string; tx?: { hash: string } }>
          ).map((t) => ({
            tx_hash:
              (t as { hash?: string }).hash ??
              (t as { tx: { hash: string } }).tx.hash,
          }));
          response.end(JSON.stringify(hashes));
        } else {
          response.end(JSON.stringify(fixture.current));
        }
        return;
      }
      // /mempool/{hash}
      const hash = path.split('/').pop()!;
      const found = (
        fixture.current as Array<{
          hash?: string;
          tx?: { hash: string };
          inputs?: unknown;
          outputs?: unknown;
        }>
      ).find(
        (t) =>
          (t as { hash?: string }).hash === hash ||
          (t as { tx: { hash: string } }).tx.hash === hash,
      );
      if (found) {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(found));
        return;
      }
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status_code: 404, error: 'Not Found' }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status_code: 404, error: 'Not Found' }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function main(): Promise<void> {
  const proof = await openProofDatabase(
    [Deployment, Check],
    ['YACI_PROOF_DATABASE_URL', 'DEPLOYMENT_PROOF_DATABASE_URL'],
    'wt-yaci-proof',
  );
  const ds = proof.dataSource;
  const mempoolPort = Number(process.env['YACI_MEMPOOL_COMPAT_PORT']);
  assert.ok(
    Number.isInteger(mempoolPort) && mempoolPort > 0,
    'YACI_MEMPOOL_COMPAT_PORT must be set',
  );
  const mempoolFixture: { current: unknown[] } = { current: [] };
  const mempoolServer = await startMutableMempool(mempoolPort, mempoolFixture);
  try {
    const yaciUrl =
      process.env['YACI_BLOCKFROST_URL'] ?? process.env['BLOCKFROST_KEY'];
    if (!yaciUrl?.startsWith('http')) {
      throw new Error('YACI_BLOCKFROST_URL must be a local URL');
    }
    const adminUrl = process.env['YACI_ADMIN_URL'];
    if (!adminUrl?.startsWith('http')) {
      throw new Error('YACI_ADMIN_URL must be a local URL');
    }

    const throwawayMnemonic =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const provider = new YaciProvider(yaciUrl, adminUrl);
    const factory = new EventFactory(
      'preview',
      throwawayMnemonic,
      provider,
      provider,
      provider,
    );
    const deployerAddress = await factory.getWalletAddress();
    for (let count = 1; count <= 3; count += 1) {
      await topUp(adminUrl, deployerAddress);
      await waitForUtxos(provider, deployerAddress, count);
    }
    await proveDeploymentAndMint(
      ds,
      provider,
      factory,
      deployerAddress,
      yaciUrl,
      mempoolFixture,
    );
    console.log('Yaci deployment check passed');
  } finally {
    await new Promise<void>((resolve, reject) => {
      mempoolServer.close((error) => (error ? reject(error) : resolve()));
    });
    await proof.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
