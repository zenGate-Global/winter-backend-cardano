import {
  EventFactory,
  ObjectDatumParameters,
} from '@zengate/winter-cardano-mesh';
import { UTxO } from '@meshsdk/core';
import { Job } from 'bull';
import {
  recreateCommodityJob,
  spendCommodityJob,
  deployRefCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';
import { UtxoService } from './palymra.utxo.service';
// import axios from 'axios';
import { Logger } from '@nestjs/common';
import { TxParser } from '@meshsdk/core';
import { CSLSerializer } from '@meshsdk/core-csl';

const logger = new Logger('Builder');

export async function buildMint(
  factory: EventFactory,
  job: Job<tokenizeCommodityJob> | { data: tokenizeCommodityJob },
  submit: boolean,
): Promise<{
  mintTxHash: string;
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

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(factory, 6)
    : await factory.getWalletUtxos();
  console.log('finalUtxos: ', finalUtxos);
  console.log('before complete tx');
  const unsignedTx = await factory.mintSingleton(
    job.data.tokenName,
    finalUtxos,
    objectDatum,
  );

  const serializer = new CSLSerializer();
  const txParser = new TxParser(serializer, factory.fetcher as any);
  const txBuilderBody = await txParser.parse(unsignedTx);
  const singleton = txBuilderBody.outputs[0].amount.find(
    (token) => token.unit !== 'lovelace',
  )!.unit;

  // We sign the transaction for the user.
  // In the future, users should be able
  // to sign there own transactions as well.
  const signedTx = await factory.signTx(unsignedTx);

  logger.log(`Mint signed tx: ${signedTx}`);

  if (submit) {
    //return submitTx(signedTx);
    const txHash = await factory.submitTx(signedTx);
    return {
      mintTxHash: txHash,
      inputUtxos: finalUtxos,
      tokenName: job.data.tokenName,
      singleton,
      contractAddress: txBuilderBody.outputs[0].address,
    };
  }
}

export async function buildDeployRef(
  factory: EventFactory,
  job: Job<deployRefCommodityJob> | { data: deployRefCommodityJob },
  submit: boolean,
): Promise<{ deploymentTxHash: string; deploymentOutputIndex: number } | void> {
  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(factory, 6)
    : await factory.getWalletUtxos();
  console.log('finalUtxos: ', finalUtxos);
  console.log('before complete tx');
  const unsignedTx = await factory.deployReference(
    job.data.deployAddress,
    job.data.tokenName,
    job.data.utxoRef,
    finalUtxos,
    false,
  );
  console.log('unsignedTx: ', unsignedTx);

  // We sign the transaction for the user.
  // In the future, users should be able
  // to sign there own transactions as well.
  const signedTx = await factory.signTx(unsignedTx);

  logger.debug(`Mint signed tx: ${signedTx}`);

  if (submit) {
    //return submitTx(signedTx);
    const txHash = await factory.submitTx(signedTx);

    return {
      deploymentTxHash: txHash,
      deploymentOutputIndex: 0,
    };
  }
}

export async function buildRecreate(
  factory: EventFactory,
  job: Job<recreateCommodityJob> | { data: recreateCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const walletAddress = await factory.getWalletAddress();

  const utxos = await factory.getUtxosByOutRef(job.data.utxos);
  const refMap = new Map();

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(factory, 6)
    : await factory.getWalletUtxos();

  const hexDataReferences = job.data.newDataReferences.map((d) =>
    Buffer.from(d, 'utf8').toString('hex'),
  );

  if (utxos.length !== hexDataReferences.length) {
    throw new Error('utxos and data references need to be the same length');
  }

  utxos.forEach((utxo, i) => {
    const assets = utxo.output.amount.filter(
      (asset) => asset.unit !== 'lovelace',
    );
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
    if (decodedDatum.data_reference_hex.bytes === hexDataReferences[i]) {
      throw new Error('data references need to be updated');
    }
  });

  const completeTx = await factory.recreate(
    walletAddress,
    finalUtxos,
    utxos,
    job.data.newDataReferences.map((d) =>
      Buffer.from(d, 'utf8').toString('hex'),
    ),
    refMap,
  );

  const signedTx = await factory.signTx(completeTx);

  logger.debug(`submit: ${submit} Recreation signed tx: ${signedTx}`);

  if (submit) {
    // return submitTx(signedTx);
    return await factory.submitTx(signedTx);
  }
}

export async function buildSpend(
  factory: EventFactory,
  job: Job<spendCommodityJob> | { data: spendCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const walletAddress = await factory.getWalletAddress();

  const utxos = await factory.getUtxosByOutRef(job.data.utxos);
  const refMap = new Map();

  for (const utxo of utxos) {
    const assets = utxo.output.amount.filter(
      (asset) => asset.unit !== 'lovelace',
    );
    const singleton = assets[0].unit;
    const scriptRefRecord = job.data.utxoRef[utxo.output.address];
    if (scriptRefRecord) {
      refMap.set(singleton, {
        singletonScriptRef: undefined,
        objectEventScriptRef: scriptRefRecord.objectEventScript,
      });
    }
  }

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(factory, 6)
    : await factory.getWalletUtxos();

  const completeTx = await factory.spend(
    walletAddress,
    walletAddress,
    finalUtxos,
    utxos,
    refMap,
  );

  const signedTx = await factory.signTx(completeTx);

  logger.debug(`Spend signed tx: ${signedTx}`);

  if (submit) {
    // return submitTx(signedTx);
    return await factory.submitTx(signedTx);
  }
}

async function getWalletUtxosWithRetry(
  winterEvent: EventFactory,
  maxAttempts: number,
  includeMempool = true,
): Promise<UTxO[]> {
  let walletUtxos: UTxO[] = [];
  let finalUtxos: UTxO[] = [];
  let attemptCount = 0;

  while (attemptCount < maxAttempts) {
    try {
      const utxoService = new UtxoService();
      walletUtxos = await winterEvent.getWalletUtxos();

      if (includeMempool) {
        const addresses = [
          ...new Set(walletUtxos.map((utxo) => utxo.output.address)),
        ];
        finalUtxos = await utxoService.getAllUtxos(walletUtxos, addresses);
      } else {
        finalUtxos = await utxoService.getNonMempoolUtxos(walletUtxos);
      }

      const lovelace = utxoService.getTotalLovelace(finalUtxos);
      logger.log(`lovelace: ${lovelace}`);
      logger.log(`finalUtxos length: ${finalUtxos.length}`);
      if (lovelace >= BigInt(2000000)) {
        break;
      } else {
        attemptCount++;
        logger.log(
          `Attempt ${attemptCount}: No available utxos founds, retrying in 10 seconds...`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    } catch (error) {
      logger.error(error);
    }
  }

  return finalUtxos;
}
