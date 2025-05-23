import {
  EventFactory,
  ObjectDatumParameters,
} from '@zengate/winter-cardano-mesh';
import { UTxO } from '@meshsdk/core';
import { Job } from 'bull';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';
import { UtxoService } from './palymra.utxo.service';
// import axios from 'axios';
import { Logger } from '@nestjs/common';

const logger = new Logger('Builder');

export async function buildMint(
  factory: EventFactory,
  job: Job<tokenizeCommodityJob> | { data: tokenizeCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const walletAddressPK = factory.getAddressPkHash();

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
  console.log('unsignedTx: ', unsignedTx);

  // We sign the transaction for the user.
  // In the future, users should be able
  // to sign there own transactions as well.
  const signedTx = await factory.signTx(unsignedTx);

  logger.debug(`Mint signed tx: ${signedTx}`);

  if (submit) {
    //return submitTx(signedTx);
    return await factory.submitTx(signedTx);
  }
}

export async function buildRecreate(
  factory: EventFactory,
  job: Job<recreateCommodityJob> | { data: recreateCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const walletAddress = factory.getWalletAddress();

  const utxos = await factory.getUtxosByOutRef(job.data.utxos);

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(factory, 6)
    : await factory.getWalletUtxos();

  const completeTx = await factory.recreate(
    walletAddress,
    finalUtxos,
    utxos,
    job.data.newDataReferences.map((d) =>
      Buffer.from(d, 'utf8').toString('hex'),
    ),
  );

  const signedTx = await factory.signTx(completeTx);

  logger.debug(`Recreation signed tx: ${signedTx}`);

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
  const walletAddress = factory.getWalletAddress();

  const utxos = await factory.getUtxosByOutRef(job.data.utxos);

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(factory, 6)
    : await factory.getWalletUtxos();

  const completeTx = await factory.spend(
    walletAddress,
    walletAddress,
    finalUtxos,
    utxos,
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
): Promise<UTxO[]> {
  let walletUtxos: UTxO[] = [];
  let finalUtxos: UTxO[] = [];
  let attemptCount = 0;

  while (attemptCount < maxAttempts) {
    try {
      const utxoService = new UtxoService()
      walletUtxos = await winterEvent.getWalletUtxos();
      finalUtxos = await utxoService.getNonMempoolUtxos(walletUtxos);
      const lovelace = utxoService.getTotalLovelace(finalUtxos);
      if (lovelace >= BigInt(20000000)) {
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
