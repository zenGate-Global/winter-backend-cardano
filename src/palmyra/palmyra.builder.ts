import {
  EventFactory,
  ObjectDatumParameters,
} from '@zengate/winter-cardano-mesh';
import { UTxO, resolveTxHash } from '@meshsdk/core';
import {
  recreateCommodityJob,
  spendCommodityJob,
  deployRefCommodityJob,
  tokenizeCommodityJob,
  UtxoQuery,
} from '../types/job.dto';
import { UtxoService } from './palymra.utxo.service';
import { Logger } from '@nestjs/common';
import { TxParser } from '@meshsdk/core';
import { CSLSerializer } from '@meshsdk/core-csl';

const logger = new Logger('Builder');

export async function buildMint(
  factory: EventFactory,
  job: { data: tokenizeCommodityJob },
  submit: boolean,
): Promise<{
  mintTxHash: string;
  signedTx: string;
  inputUtxos: UTxO[];
  tokenName: string;
  singleton: string;
  contractAddress: string;
} | void> {
  const walletAddressPK = await factory.getAddressPkHash();

  const params: ObjectDatumParameters = {
    protocolVersion: 1,
    dataReferenceHex: Buffer.from(job.data.metadataReference, 'utf8').toString(
      'hex',
    ),
    eventCreationInfoTxHash: Buffer.from('', 'utf8').toString('hex'),
    signersPkHash: [walletAddressPK],
  };
  const objectDatum = EventFactory.getObjectDatumFromParams(params);

  const finalUtxos = await getFundingUtxos(factory, submit);

  validateCollateral(factory, finalUtxos);

  const unsignedTx = await factory.mintSingleton(
    job.data.tokenName,
    finalUtxos,
    objectDatum,
  );

  const serializer = new CSLSerializer();
  const txParser = new TxParser(
    serializer,
    factory.fetcher as unknown as ConstructorParameters<typeof TxParser>[1],
  );
  // Hand the parser the UTxOs we already hold. Without them it re-resolves
  // every input, collateral and reference outref through the fetcher, and
  // Blockfrost only knows confirmed transactions, so a build that chains onto
  // an unconfirmed change output fails here with a 404 even though the build
  // itself succeeded. This is what caps mint throughput at the number of
  // confirmed wallet UTxOs.
  const txBuilderBody = await txParser.parse(unsignedTx, finalUtxos);
  const singleton = txBuilderBody.outputs[0].amount.find(
    (token) => token.unit !== 'lovelace',
  )!.unit;

  if (!submit) {
    return;
  }

  const signedTx = await factory.signTx(unsignedTx);
  const txHash = resolveTxHash(signedTx);
  // ponytail: caller persists hash+signedTx before submit for idempotency

  return {
    mintTxHash: txHash,
    signedTx,
    inputUtxos: finalUtxos,
    tokenName: job.data.tokenName,
    singleton,
    contractAddress: txBuilderBody.outputs[0].address,
  };
}

export async function buildDeployRef(
  factory: EventFactory,
  job: { data: deployRefCommodityJob },
  submit: boolean,
): Promise<{
  deploymentTxHash: string;
  deploymentOutputIndex: number;
  signedTx: string;
} | void> {
  const finalUtxos = await getFundingUtxos(factory, submit);

  validateCollateral(factory, finalUtxos);

  const unsignedTx = await factory.deployReference(
    job.data.deployAddress,
    job.data.tokenName,
    job.data.utxoRef,
    finalUtxos,
    false,
  );

  if (!submit) {
    return;
  }

  const signedTx = await factory.signTx(unsignedTx);
  const txHash = resolveTxHash(signedTx);

  return {
    deploymentTxHash: txHash,
    deploymentOutputIndex: 0,
    signedTx,
  };
}

// Pairs each new data reference with its UTxO by explicit outref, not by
// position. @zengate/winter-cardano-mesh 2.0.1 returns the fetched UTxOs in the
// order the caller asked for, so a positional pair is correct today. This map
// stays because it is invariant to that contract. When the pairing is wrong the
// transaction still builds, still submits and still succeeds, and it writes one
// commodity data reference into another commodity datum on chain, where nothing
// can undo it. Nineteen lines is a fair price for a guard on that path.
export function alignRecreateDataReferences(
  requestUtxos: UtxoQuery[],
  newDataReferences: string[],
  fetchedUtxos: UTxO[],
): string[] {
  const map = new Map<string, string>();
  requestUtxos.forEach((u, idx) => {
    const hex = Buffer.from(newDataReferences[idx], 'utf8').toString('hex');
    map.set(`${u.txHash}#${u.outputIndex}`, hex);
  });
  return fetchedUtxos.map((utxo) => {
    const key = `${utxo.input.txHash}#${utxo.input.outputIndex}`;
    const hex = map.get(key);
    if (hex === undefined) {
      throw new Error(`Missing data reference for UTxO ${key}`);
    }
    return hex;
  });
}

export async function buildRecreate(
  factory: EventFactory,
  job: { data: recreateCommodityJob },
  submit: boolean,
): Promise<{
  hash: string;
  signedTx: string;
  orderedOutRefs: UtxoQuery[];
} | void> {
  const walletAddress = await factory.getWalletAddress();

  const utxos = await factory.getUtxosByOutRef(job.data.utxos);
  if (utxos.length === 0) {
    throw new Error('No UTxOs resolved for recreate');
  }
  const refMap = new Map();

  const finalUtxos = await getFundingUtxos(factory, submit);

  validateCollateral(factory, finalUtxos);

  if (utxos.length !== job.data.newDataReferences.length) {
    throw new Error('utxos and data references need to be the same length');
  }

  const alignedHex = alignRecreateDataReferences(
    job.data.utxos,
    job.data.newDataReferences,
    utxos,
  );

  utxos.forEach((utxo, i) => {
    const assets = utxo.output.amount.filter(
      (asset) => asset.unit !== 'lovelace',
    );
    if (assets.length === 0 || !assets[0].unit) {
      throw new Error(
        `UTxO ${utxo.input.txHash}#${utxo.input.outputIndex} holds only lovelace`,
      );
    }
    const singleton = assets[0].unit;
    const scriptRefRecord = job.data.utxoRef[utxo.output.address];
    if (scriptRefRecord) {
      refMap.set(singleton, {
        singletonScriptRef: undefined,
        objectEventScriptRef: scriptRefRecord.objectEventScript,
      });
    }
    const decodedDatum = EventFactory.getObjectDatumFieldsFromPlutusCbor(
      utxo.output.plutusData!,
    );
    if (decodedDatum.data_reference_hex.bytes === alignedHex[i]) {
      throw new Error('data references need to be updated');
    }
  });

  const completeTx = await factory.recreate(
    walletAddress,
    finalUtxos,
    utxos,
    alignedHex,
    refMap,
  );

  if (!submit) {
    return;
  }

  const signedTx = await factory.signTx(completeTx);
  const hash = resolveTxHash(signedTx);
  const orderedOutRefs: UtxoQuery[] = utxos.map((u) => ({
    txHash: u.input.txHash,
    outputIndex: u.input.outputIndex,
  }));

  return { hash, signedTx, orderedOutRefs };
}

export async function buildSpend(
  factory: EventFactory,
  job: { data: spendCommodityJob },
  submit: boolean,
): Promise<{ hash: string; signedTx: string } | void> {
  const walletAddress = await factory.getWalletAddress();

  const utxos = await factory.getUtxosByOutRef(job.data.utxos);
  if (utxos.length === 0) {
    throw new Error('No UTxOs resolved for spend');
  }
  const refMap = new Map();

  for (const utxo of utxos) {
    const assets = utxo.output.amount.filter(
      (asset) => asset.unit !== 'lovelace',
    );
    if (assets.length === 0 || !assets[0].unit) {
      throw new Error(
        `UTxO ${utxo.input.txHash}#${utxo.input.outputIndex} holds only lovelace`,
      );
    }
    const singleton = assets[0].unit;
    const scriptRefRecord = job.data.utxoRef[utxo.output.address];
    if (scriptRefRecord) {
      refMap.set(singleton, {
        singletonScriptRef: undefined,
        objectEventScriptRef: scriptRefRecord.objectEventScript,
      });
    }
  }

  const finalUtxos = await getFundingUtxos(factory, submit);

  validateCollateral(factory, finalUtxos);

  const completeTx = await factory.spend(
    walletAddress,
    finalUtxos,
    utxos,
    refMap,
  );

  if (!submit) {
    return;
  }

  const signedTx = await factory.signTx(completeTx);
  const hash = resolveTxHash(signedTx);

  return { hash, signedTx };
}

function validateCollateral(factory: EventFactory, utxos: UTxO[]): void {
  const collateral = factory.getCollateralUTxOs(utxos);
  if (collateral.length > 3) {
    throw new Error(`TooManyCollateralInputs: ${collateral.length} exceeds 3`);
  }
  if (collateral.length > 0) {
    const total = collateral.reduce((acc, u) => {
      const ada = u.output.amount.find((a) => a.unit === 'lovelace');
      return acc + BigInt(ada ? ada.quantity : '0');
    }, BigInt(0));
    if (total < BigInt(5000000)) {
      throw new Error(`Insufficient collateral: ${total} lovelace`);
    }
  }
}

// A deployed reference script sits in this same wallet, because DEPLOYER_ADDRESS
// is the service address. Mesh coin selection treats that output as ordinary
// funding and will spend it, which destroys the deployment. Every later recreate
// and spend then fails with BadInputsUTxO on a reference input that no longer
// exists, until an operator deletes the deployment row and pays about 20 ADA to
// deploy again. A reference script is infrastructure, never working capital.
function excludeReferenceScripts(utxos: UTxO[]): UTxO[] {
  return utxos.filter(
    (utxo) => !utxo.output.scriptRef && !utxo.output.scriptHash,
  );
}

// The single funding path. Both branches run through the same filter so a dry
// run and the real build cannot disagree about which UTxOs are spendable.
async function getFundingUtxos(
  factory: EventFactory,
  submit: boolean,
): Promise<UTxO[]> {
  const utxos = submit
    ? await getWalletUtxosWithRetry(factory, 6)
    : await factory.getWalletUtxos();
  return excludeReferenceScripts(utxos);
}

async function getWalletUtxosWithRetry(
  winterEvent: EventFactory,
  maxAttempts: number,
): Promise<UTxO[]> {
  const utxoService = new UtxoService();
  let lastError: Error | undefined;
  let finalUtxos: UTxO[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const walletUtxos = await winterEvent.getWalletUtxos();
      const addresses = [
        ...new Set(walletUtxos.map((utxo) => utxo.output.address)),
      ];
      finalUtxos = await utxoService.getAllUtxos(walletUtxos, addresses);
      return finalUtxos;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error(
        `getWalletUtxos attempt ${attempt} failed: ${lastError.message}`,
      );
      if (attempt === maxAttempts) {
        break;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * Math.min(Math.pow(2, attempt - 1), 10)),
      );
    }
  }

  throw (
    lastError ?? new Error('getWalletUtxosWithRetry exhausted without error')
  );
}
