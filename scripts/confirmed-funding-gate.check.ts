import assert from 'node:assert/strict';
import { EventFactory } from '@zengate/winter-cardano-mesh';
import type { UTxO } from '@meshsdk/core';
import { CheckStatus } from '../src/check/entities/check.entity';
import { NoConfirmedFundingUtxoError } from '../src/palmyra/no-confirmed-funding-utxo.error';
import { InsufficientConfirmedFundingError } from '../src/palmyra/insufficient-confirmed-funding.error';
import {
  buildDeployRef,
  buildMint,
  buildRecreate,
  buildSpend,
} from '../src/palmyra/palmyra.builder';
import { PalmyraConsumerService } from '../src/palmyra/palmyra.consumer.service';
import { UtxoService } from '../src/palmyra/palymra.utxo.service';
import type {
  deployRefCommodityJob,
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../src/types/job.dto';

const BUILD_REACHED = new Error('builder reached transaction library');
const WALLET_ADDRESS = 'addr_test1_offline';
const EVENT_ADDRESS = 'addr_test1_event';

type UtxoSets = { confirmed: UTxO[]; unconfirmed: UTxO[] };
type FactoryProbe = {
  factory: EventFactory;
  funding: UTxO[] | undefined;
  collateralSources: UTxO[][];
  calls: Record<'mint' | 'recreate' | 'spend' | 'deploy-ref', number>;
};
type ConsumerAccess = {
  logger: {
    warn: (message: string) => void;
    log: (message: string) => void;
    error: (message: string) => void;
  };
  checkDb: {
    findOne: (id: string) => Promise<{
      status: CheckStatus;
      txid: string | null;
      signedTx: string | null;
    }>;
    update: (
      id: string,
      patch: { status?: CheckStatus; error?: string },
    ) => Promise<void>;
  };
  isTransientBuildError: (error: unknown) => boolean;
  retryBuildTransaction: <T>(
    buildFunction: () => Promise<T>,
    maxAttempts: number,
  ) => Promise<T>;
  recordFailure: (
    id: string,
    operation: string,
    error: unknown,
  ) => Promise<void>;
  markRetriesExhausted: (id: string, error: unknown) => Promise<void>;
};

function makeUtxo(
  txHash: string,
  outputIndex: number,
  lovelace: string,
  address = WALLET_ADDRESS,
  scriptRef?: string,
): UTxO {
  return {
    input: { txHash, outputIndex },
    output: {
      address,
      amount: [{ unit: 'lovelace', quantity: lovelace }],
      scriptRef,
      scriptHash: undefined,
    },
  } as UTxO;
}

function makeEventUtxo(txHash: string, outputIndex: number): UTxO {
  return {
    input: { txHash, outputIndex },
    output: {
      address: EVENT_ADDRESS,
      amount: [
        { unit: 'lovelace', quantity: '2000000' },
        { unit: 'a'.repeat(56), quantity: '1' },
      ],
      plutusData: 'offline-datum',
    },
  } as UTxO;
}

function makeFactory(
  walletUtxos: UTxO[],
  libraryError: Error = BUILD_REACHED,
): FactoryProbe {
  const probe: FactoryProbe = {
    factory: undefined as unknown as EventFactory,
    funding: undefined,
    collateralSources: [],
    calls: { mint: 0, recreate: 0, spend: 0, 'deploy-ref': 0 },
  };
  probe.factory = {
    fetcher: {},
    getWalletUtxos: async () => walletUtxos,
    getWalletAddress: async () => WALLET_ADDRESS,
    getAddressPkHash: async () => 'ab'.repeat(28),
    getUtxosByOutRef: async (refs: { txHash: string; outputIndex: number }[]) =>
      refs.map((ref) => makeEventUtxo(ref.txHash, ref.outputIndex)),
    getCollateralUTxOs: (utxos: UTxO[]) => {
      probe.collateralSources.push(utxos);
      const pureAda = utxos
        .filter(
          (utxo) =>
            utxo.output.amount.length === 1 &&
            utxo.output.amount[0].unit === 'lovelace',
        )
        .toSorted((left, right) =>
          BigInt(right.output.amount[0].quantity) >
          BigInt(left.output.amount[0].quantity)
            ? 1
            : -1,
        );
      return pureAda.length > 0 ? [pureAda[0]] : [];
    },
    mintSingleton: async (
      _tokenName: string,
      funding: UTxO[],
      _datum: unknown,
    ) => {
      probe.calls.mint++;
      probe.funding = funding;
      throw libraryError;
    },
    recreate: async (
      _walletAddress: string,
      funding: UTxO[],
      _events: UTxO[],
      _references: string[],
      _refMap: Map<string, unknown>,
    ) => {
      probe.calls.recreate++;
      probe.funding = funding;
      throw libraryError;
    },
    spend: async (
      _walletAddress: string,
      funding: UTxO[],
      _events: UTxO[],
      _refMap: Map<string, unknown>,
    ) => {
      probe.calls.spend++;
      probe.funding = funding;
      throw libraryError;
    },
    deployReference: async (
      _deployAddress: string,
      _tokenName: string,
      _utxoRef: { txHash: string; outputIndex: number },
      funding: UTxO[],
      _useV2: boolean,
    ) => {
      probe.calls['deploy-ref']++;
      probe.funding = funding;
      throw libraryError;
    },
  } as unknown as EventFactory;
  return probe;
}

function setUtxoSets(sets: UtxoSets): void {
  UtxoService.prototype.flushMempool = async () => [];
  UtxoService.prototype.getUtxoSets = async () => sets;
}

const tokenizeJob: tokenizeCommodityJob = {
  id: 'mint-job',
  tokenName: 'offline-token',
  metadataReference: 'offline-cid',
};
const eventRef = { txHash: 'e'.repeat(64), outputIndex: 0 };
const recreateJob: recreateCommodityJob = {
  id: 'recreate-job',
  utxos: [eventRef],
  newDataReferences: ['replacement-cid'],
  utxoRef: {},
};
const spendJob: spendCommodityJob = {
  id: 'spend-job',
  utxos: [eventRef],
  utxoRef: {},
};
const deployRefJob: deployRefCommodityJob = {
  id: 'deploy-job',
  tokenName: 'offline-token',
  deployAddress: WALLET_ADDRESS,
  utxoRef: eventRef,
};

async function runBuilder(
  kind: 'mint' | 'recreate' | 'spend' | 'deploy-ref',
  factory: EventFactory,
): Promise<void> {
  switch (kind) {
    case 'mint':
      await buildMint(factory, { data: tokenizeJob }, true);
      return;
    case 'recreate':
      await buildRecreate(factory, { data: recreateJob }, true);
      return;
    case 'spend':
      await buildSpend(factory, { data: spendJob }, true);
      return;
    case 'deploy-ref':
      await buildDeployRef(factory, { data: deployRefJob }, true);
  }
}

async function checkConsumerDeferral(): Promise<void> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const updates: { id: string; status?: CheckStatus; error?: string }[] = [];
  const consumer = Object.create(
    PalmyraConsumerService.prototype,
  ) as ConsumerAccess;
  consumer.logger = {
    warn: (message) => warnings.push(message),
    log: () => undefined,
    error: (message) => errors.push(message),
  };
  consumer.checkDb = {
    findOne: async () => ({
      status: CheckStatus.QUEUED,
      txid: null,
      signedTx: null,
    }),
    update: async (id, patch) => {
      updates.push({ id, ...patch });
    },
  };

  const refusal = new NoConfirmedFundingUtxoError(0, 2);
  assert.equal(consumer.isTransientBuildError(refusal), true);

  let buildCalls = 0;
  let timerCalls = 0;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: () => void) => {
    timerCalls++;
    queueMicrotask(callback);
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  try {
    await assert.rejects(
      consumer.retryBuildTransaction(async () => {
        buildCalls++;
        throw refusal;
      }, 3),
      (error) => error === refusal,
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(
    buildCalls,
    1,
    'the internal retry loop must call the build once',
  );
  assert.equal(timerCalls, 0, 'the internal retry loop must not sleep');
  assert.deepEqual(warnings, [
    'No confirmed funding UTxO: 0 confirmed, 2 unconfirmed',
  ]);

  await assert.rejects(
    consumer.recordFailure('mint-job', 'minting', refusal),
    (error) => error === refusal,
  );
  assert.deepEqual(updates, [
    {
      id: 'mint-job',
      error:
        'minting error: No confirmed funding UTxO is available (0 confirmed, 2 unconfirmed)',
    },
  ]);
  assert.equal(Object.hasOwn(updates[0], 'status'), false);

  const insufficient = new InsufficientConfirmedFundingError(
    new Error('Not enough UTxOs to cover the required value.'),
  );
  assert.equal(consumer.isTransientBuildError(insufficient), true);
  let insufficientBuildCalls = 0;
  let insufficientTimerCalls = 0;
  globalThis.setTimeout = ((callback: () => void) => {
    insufficientTimerCalls++;
    queueMicrotask(callback);
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout;
  try {
    await assert.rejects(
      consumer.retryBuildTransaction(async () => {
        insufficientBuildCalls++;
        throw insufficient;
      }, 3),
      (error) => error === insufficient,
    );
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(insufficientBuildCalls, 1);
  assert.equal(insufficientTimerCalls, 0);
  assert.equal(warnings.at(-1), insufficient.message);

  updates.length = 0;
  await assert.rejects(
    consumer.recordFailure('mint-job', 'minting', insufficient),
    (error) => error === insufficient,
  );
  assert.deepEqual(updates, [
    {
      id: 'mint-job',
      error:
        'minting error: Confirmed funding UTxOs cannot cover the transaction',
    },
  ]);
  assert.equal(Object.hasOwn(updates[0], 'status'), false);

  const providerErrors = [
    Object.assign(new Error('provider unavailable'), { status_code: 429 }),
    Object.assign(new Error('provider unavailable'), { status_code: 503 }),
    Object.assign(new Error('provider unavailable'), { code: 'EHOSTUNREACH' }),
    Object.assign(new Error('provider unavailable'), { code: 'EPIPE' }),
    Object.assign(new Error('provider unavailable'), {
      code: 'ERR_GOT_REQUEST_ERROR',
    }),
    Object.assign(new Error('provider unavailable'), {
      name: 'BlockfrostClientError',
    }),
    new Error(
      JSON.stringify({
        data: { detail: 'private upstream detail' },
        headers: { request: 'private upstream header' },
        status: 429,
      }),
    ),
  ];
  for (const providerError of providerErrors) {
    updates.length = 0;
    assert.equal(consumer.isTransientBuildError(providerError), true);
    await assert.rejects(
      consumer.recordFailure('mint-job', 'minting', providerError),
      (error) => error === providerError,
    );
    assert.deepEqual(updates, [
      {
        id: 'mint-job',
        error: 'minting error: provider request failed',
      },
    ]);
    assert.equal(Object.hasOwn(updates[0], 'status'), false);
  }

  updates.length = 0;
  await consumer.markRetriesExhausted('mint-job', providerErrors[0]);
  assert.deepEqual(updates, [
    {
      id: 'mint-job',
      status: CheckStatus.ERROR,
      error: 'retries exhausted: provider request failed',
    },
  ]);
  assert.equal(
    errors.at(-1),
    'Retries exhausted for mint-job: provider request failed',
  );

  updates.length = 0;
  await consumer.markRetriesExhausted('mint-job', refusal);
  assert.deepEqual(updates, [
    {
      id: 'mint-job',
      status: CheckStatus.ERROR,
      error: 'No confirmed funding UTxO: 0 confirmed, 2 unconfirmed',
    },
  ]);

  assert.equal(
    errors.at(-1),
    'Retries exhausted for mint-job: No confirmed funding UTxO: 0 confirmed, 2 unconfirmed',
  );
  updates.length = 0;
  await consumer.markRetriesExhausted('mint-job', insufficient);
  assert.deepEqual(updates, [
    {
      id: 'mint-job',
      status: CheckStatus.ERROR,
      error:
        'retries exhausted: Confirmed funding UTxOs cannot cover the transaction',
    },
  ]);
  assert.equal(
    errors.at(-1),
    'Retries exhausted for mint-job: Confirmed funding UTxOs cannot cover the transaction',
  );
  assert.equal(errors.length, 3);
}
async function checkConsumerOperationLogging(): Promise<void> {
  const operations = [
    {
      name: 'minting',
      id: tokenizeJob.id,
      run: (consumer: any) => consumer.tokenizeCommodity(tokenizeJob),
    },
    {
      name: 'recreating',
      id: recreateJob.id,
      run: (consumer: any) => consumer.recreateCommodity(recreateJob),
    },
    {
      name: 'spending',
      id: spendJob.id,
      run: (consumer: any) => consumer.spendCommodity(spendJob),
    },
  ] as const;
  const deferrals = [
    new NoConfirmedFundingUtxoError(0, 2),
    new InsufficientConfirmedFundingError(
      new Error('Not enough UTxOs to cover the required value.'),
    ),
  ];

  for (const operation of operations) {
    for (const deferral of deferrals) {
      const warnings: string[] = [];
      const errors: string[] = [];
      const updates: { status?: CheckStatus; error?: string }[] = [];
      const consumer = Object.create(PalmyraConsumerService.prototype) as any;
      consumer.logger = {
        warn: (message: string) => warnings.push(message),
        log: () => undefined,
        error: (message: string) => errors.push(message),
      };
      consumer.handleExistingTx = async () => {
        throw deferral;
      };
      consumer.checkDb = {
        findOne: async () => ({
          status: CheckStatus.QUEUED,
          txid: null,
          signedTx: null,
        }),
        update: async (
          _id: string,
          patch: { status?: CheckStatus; error?: string },
        ) => {
          updates.push(patch);
        },
      };

      await assert.rejects(
        operation.run(consumer),
        (error: unknown) => error === deferral,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, [
        `Deferred ${operation.name}: ${deferral.message}`,
        `Transient build failure for ${operation.id}, returning to the queue: ${operation.name} error: ${deferral.message}`,
      ]);
      assert.deepEqual(updates, [
        { error: `${operation.name} error: ${deferral.message}` },
      ]);
    }

    const fatal = new Error('ordinary fatal failure');
    const warnings: string[] = [];
    const errors: string[] = [];
    const updates: { status?: CheckStatus; error?: string }[] = [];
    const consumer = Object.create(PalmyraConsumerService.prototype) as any;
    consumer.logger = {
      warn: (message: string) => warnings.push(message),
      log: () => undefined,
      error: (message: string) => errors.push(message),
    };
    consumer.handleExistingTx = async () => {
      throw fatal;
    };
    consumer.checkDb = {
      findOne: async () => ({
        status: CheckStatus.QUEUED,
        txid: null,
        signedTx: null,
      }),
      update: async (
        _id: string,
        patch: { status?: CheckStatus; error?: string },
      ) => {
        updates.push(patch);
      },
    };

    await operation.run(consumer);
    assert.deepEqual(warnings, []);
    assert.deepEqual(errors, [
      `Error ${operation.name}: Error: ordinary fatal failure`,
    ]);
    assert.deepEqual(updates, [
      {
        status: CheckStatus.ERROR,
        error: `${operation.name} error: ordinary fatal failure`,
      },
    ]);
  }
}
async function checkPostSubmitDeploymentDeferral(): Promise<void> {
  for (const shortage of [
    new NoConfirmedFundingUtxoError(0, 1),
    new InsufficientConfirmedFundingError(
      new Error('Not enough UTxOs to cover the required value.'),
    ),
  ]) {
    for (const status of [CheckStatus.SUBMITTED, CheckStatus.QUEUED]) {
      const txid = '5'.repeat(64);
      const signedTx = 'stored-signed-cbor';
      let deploymentCalls = 0;
      let submitCalls = 0;
      const warnings: string[] = [];
      const errors: string[] = [];
      let failureCalls = 0;
      let transactionWrites = 0;
      const consumer = Object.create(PalmyraConsumerService.prototype) as any;
      consumer.logger = {
        warn: (message: string) => warnings.push(message),
        log: () => undefined,
        error: (message: string) => errors.push(message),
      };
      consumer.handleExistingTx = async () => ({
        kind: 'existing',
        txid,
        signedTx,
        storedSignedTx: signedTx,
        deployment: undefined,
      });
      consumer.checkDb = {
        findOne: async () => ({ status, txid, signedTx }),
      };
      consumer.ensureDeployment = async (
        _data: tokenizeCommodityJob,
        actualTxid: string,
        actualSignedTx: string,
      ) => {
        deploymentCalls++;
        assert.equal(actualTxid, txid);
        assert.equal(actualSignedTx, signedTx);
        throw shortage;
      };
      consumer.submitWithHashCheck = async (
        _id: string,
        actualSignedTx: string,
        actualTxid: string,
        storedSignedTx: string,
      ) => {
        submitCalls++;
        assert.equal(actualSignedTx, signedTx);
        assert.equal(actualTxid, txid);
        assert.equal(storedSignedTx, signedTx);
      };
      consumer.recordFailure = async (
        _id: string,
        _operation: string,
        error: unknown,
      ) => {
        failureCalls++;
        assert.equal(error, shortage);
        throw error;
      };
      consumer.db = {
        create: async () => {
          transactionWrites++;
        },
      };

      await assert.rejects(
        consumer.tokenizeCommodity(tokenizeJob),
        (error: unknown) => error === shortage,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, [`Deferred minting: ${shortage.message}`]);
      assert.equal(deploymentCalls, 1);
      assert.equal(submitCalls, status === CheckStatus.QUEUED ? 1 : 0);
      assert.equal(failureCalls, 1);
      assert.equal(transactionWrites, 0);
    }
  }
}

async function checkMempoolFailure(): Promise<void> {
  const failure = new Error('offline mempool failure');
  const service = Object.create(UtxoService.prototype) as UtxoService;
  (service as unknown as { bf: { mempoolAll: () => Promise<never> } }).bf = {
    mempoolAll: async () => {
      throw failure;
    },
  };
  await assert.rejects(service.flushMempool(), (error) => error === failure);
}

async function main(): Promise<void> {
  const utxoModule = require('../src/palmyra/palymra.utxo.service') as {
    UtxoService: typeof UtxoService;
  };
  const originalUtxoService = utxoModule.UtxoService;
  utxoModule.UtxoService = new Proxy(originalUtxoService, {
    construct: () => Object.create(originalUtxoService.prototype),
  });
  const originalGetUtxoSets = UtxoService.prototype.getUtxoSets;
  const originalFlushMempool = UtxoService.prototype.flushMempool;
  const eventFactory = await import('@zengate/winter-cardano-mesh');
  const originalDecode =
    eventFactory.EventFactory.getObjectDatumFieldsFromPlutusCbor;
  const originalDecodeTop = (
    EventFactory as unknown as {
      getObjectDatumFieldsFromPlutusCbor: () => unknown;
    }
  ).getObjectDatumFieldsFromPlutusCbor;
  (
    eventFactory.EventFactory as unknown as {
      getObjectDatumFieldsFromPlutusCbor: () => unknown;
    }
  ).getObjectDatumFieldsFromPlutusCbor = () => ({
    data_reference_hex: { bytes: 'old-reference' },
  });
  (
    EventFactory as unknown as {
      getObjectDatumFieldsFromPlutusCbor: () => unknown;
    }
  ).getObjectDatumFieldsFromPlutusCbor = () => ({
    data_reference_hex: { bytes: 'old-reference' },
  });
  try {
    await checkMempoolFailure();
    const spentConfirmed = makeUtxo('1'.repeat(64), 0, '6000000');
    const unspentConfirmed = makeUtxo('2'.repeat(64), 1, '7000000');
    const unspentMempoolOutput = makeUtxo('3'.repeat(64), 0, '8000000');
    const spentMempoolOutput = makeUtxo('4'.repeat(64), 1, '9000000');
    const utxoService = Object.create(UtxoService.prototype) as UtxoService;
    utxoService.flushMempool = async () => [];
    utxoService.getUnconfirmedInputs = async () => [
      spentConfirmed.input,
      spentMempoolOutput.input,
    ];
    utxoService.getUnconfirmedOutputs = async () => [
      unspentMempoolOutput,
      spentMempoolOutput,
    ];

    assert.deepEqual(
      await originalGetUtxoSets.call(
        utxoService,
        [spentConfirmed, unspentConfirmed],
        [WALLET_ADDRESS],
        [],
      ),
      {
        confirmed: [unspentConfirmed],
        unconfirmed: [unspentMempoolOutput],
      },
    );

    const readOrder: string[] = [];
    UtxoService.prototype.flushMempool = async () => {
      readOrder.push('mempool');
      return [];
    };
    UtxoService.prototype.getUtxoSets = async () => ({
      confirmed: [unspentConfirmed],
      unconfirmed: [],
    });
    const orderProbe = makeFactory([unspentConfirmed]);
    orderProbe.factory.getWalletAddress = async () => {
      readOrder.push('address');
      return WALLET_ADDRESS;
    };
    orderProbe.factory.getWalletUtxos = async () => {
      readOrder.push('wallet');
      return [unspentConfirmed];
    };
    await assert.rejects(
      runBuilder('mint', orderProbe.factory),
      (error) => error === BUILD_REACHED,
    );
    assert.deepEqual(readOrder, ['address', 'mempool', 'wallet']);
    const unconfirmed = makeUtxo('u'.repeat(64), 0, '480000000');
    setUtxoSets({ confirmed: [], unconfirmed: [unconfirmed] });
    for (const kind of ['mint', 'recreate', 'spend', 'deploy-ref'] as const) {
      const probe = makeFactory([makeUtxo('a'.repeat(64), 0, '6000000')]);
      const warnings: string[] = [];
      const updates: unknown[] = [];
      const consumer = Object.create(
        PalmyraConsumerService.prototype,
      ) as ConsumerAccess;
      consumer.logger = {
        warn: (message) => warnings.push(message),
        log: () => undefined,
        error: () => undefined,
      };
      consumer.checkDb = {
        findOne: async () => ({
          status: CheckStatus.QUEUED,
          txid: null,
          signedTx: null,
        }),
        update: async () => {
          updates.push(1);
        },
      };
      let buildCalls = 0;
      let timerCalls = 0;
      const originalSetTimeout = globalThis.setTimeout;
      globalThis.setTimeout = ((callback: () => void) => {
        timerCalls++;
        queueMicrotask(callback);
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout;
      try {
        await assert.rejects(
          consumer.retryBuildTransaction(async () => {
            buildCalls++;
            await runBuilder(kind, probe.factory);
          }, 3),
          NoConfirmedFundingUtxoError,
        );
      } finally {
        globalThis.setTimeout = originalSetTimeout;
      }
      assert.equal(buildCalls, 1);
      assert.equal(timerCalls, 0);
      assert.equal(
        probe.calls[kind],
        0,
        `${kind} must stop before the library`,
      );
      assert.equal(probe.funding, undefined);
      assert.deepEqual(probe.collateralSources, []);
      assert.equal(
        consumer.isTransientBuildError(new NoConfirmedFundingUtxoError(0, 1)),
        true,
      );
    }

    const confirmed = makeUtxo('c'.repeat(64), 0, '6000000');
    setUtxoSets({ confirmed: [confirmed], unconfirmed: [unconfirmed] });
    for (const kind of ['mint', 'recreate', 'spend', 'deploy-ref'] as const) {
      const probe = makeFactory([confirmed]);
      await assert.rejects(
        runBuilder(kind, probe.factory),
        (error) => error === BUILD_REACHED,
      );
      assert.equal(probe.calls[kind], 1, `${kind} must reach the library`);
      assert.deepEqual(probe.funding, [confirmed]);
      assert.deepEqual(probe.collateralSources, [[confirmed]]);
    }

    const meshInsufficient = new Error(
      'Not enough UTxOs to cover the required value.',
    );
    setUtxoSets({ confirmed: [confirmed], unconfirmed: [unconfirmed] });
    for (const kind of ['mint', 'recreate', 'spend', 'deploy-ref'] as const) {
      const probe = makeFactory([confirmed], meshInsufficient);
      await assert.rejects(runBuilder(kind, probe.factory), (error) => {
        return (
          error instanceof InsufficientConfirmedFundingError &&
          error.cause === meshInsufficient
        );
      });
      assert.equal(probe.calls[kind], 1);
      assert.deepEqual(probe.funding, [confirmed]);
      assert.deepEqual(probe.collateralSources, [[confirmed]]);
    }

    const referenceScript = makeUtxo(
      'r'.repeat(64),
      0,
      '6000000',
      WALLET_ADDRESS,
      'reference-script',
    );
    setUtxoSets({ confirmed: [referenceScript], unconfirmed: [] });
    const probe = makeFactory([referenceScript]);
    await assert.rejects(
      runBuilder('mint', probe.factory),
      NoConfirmedFundingUtxoError,
    );
    assert.equal(probe.calls.mint, 0);
    assert.equal(probe.funding, undefined);
    assert.deepEqual(probe.collateralSources, []);

    await checkConsumerDeferral();
    await checkConsumerOperationLogging();
    await checkPostSubmitDeploymentDeferral();
  } finally {
    UtxoService.prototype.getUtxoSets = originalGetUtxoSets;
    UtxoService.prototype.flushMempool = originalFlushMempool;
    eventFactory.EventFactory.getObjectDatumFieldsFromPlutusCbor =
      originalDecode;
    (
      EventFactory as unknown as {
        getObjectDatumFieldsFromPlutusCbor: () => unknown;
      }
    ).getObjectDatumFieldsFromPlutusCbor = originalDecodeTop;
    utxoModule.UtxoService = originalUtxoService;
  }

  console.log('confirmed funding gate check passed');
}

void main();
