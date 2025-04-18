import {
  EventFactory,
  ObjectDatumParameters,
} from '@zengate/winter-cardano-mesh';
import { NETWORK, ZENGATE_MNEMONIC } from '../constants';
import { IEvaluator, IFetcher, ISubmitter, UTxO } from '@meshsdk/core';
import { Job } from 'bull';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';
import { getNonMempoolUtxos, getTotalLovelace } from './palymra.utxo.service';
// import axios from 'axios';
import { Logger } from '@nestjs/common';

const logger = new Logger('Builder');

export async function buildMint(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<tokenizeCommodityJob> | { data: tokenizeCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const winterFactory = new EventFactory(
    NETWORK(),
    ZENGATE_MNEMONIC(),
    provider,
    provider,
    provider,
  );

  const walletAddressPK = winterFactory.getAddressPkHash();

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
    ? await getWalletUtxosWithRetry(winterFactory, 6)
    : await winterFactory.getWalletUtxos();
  console.log('finalUtxos: ', finalUtxos);
  console.log('before complete tx');
  const unsignedTx = await winterFactory.mintSingleton(
    job.data.tokenName,
    finalUtxos,
    objectDatum,
  );
  console.log('unsignedTx: ', unsignedTx);

  // We sign the transaction for the user.
  // In the future, users should be able
  // to sign there own transactions as well.
  const signedTx = await winterFactory.signTx(unsignedTx);

  logger.debug(`Mint signed tx: ${signedTx}`);

  if (submit) {
    //return submitTx(signedTx);
    return await winterFactory.submitTx(signedTx);
  }
}

export async function buildRecreate(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<recreateCommodityJob> | { data: recreateCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const winterEvent = new EventFactory(
    NETWORK(),
    ZENGATE_MNEMONIC(),
    provider,
    provider,
    provider,
  );

  const walletAddress = winterEvent.getWalletAddress();

  const utxos = await winterEvent.getUtxosByOutRef(job.data.utxos);

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(winterEvent, 6)
    : await winterEvent.getWalletUtxos();

  const completeTx = await winterEvent.recreate(
    walletAddress,
    finalUtxos,
    utxos,
    job.data.newDataReferences.map((d) =>
      Buffer.from(d, 'utf8').toString('hex'),
    ),
  );

  const signedTx = await winterEvent.signTx(completeTx);

  logger.debug(`Recreation signed tx: ${signedTx}`);

  if (submit) {
    // return submitTx(signedTx);
    return await winterEvent.submitTx(signedTx);
  }
}

export async function buildSpend(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<spendCommodityJob> | { data: spendCommodityJob },
  submit: boolean,
): Promise<string | void> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const winterEvent = new EventFactory(
    NETWORK(),
    ZENGATE_MNEMONIC(),
    provider,
    provider,
    provider,
  );

  const walletAddress = winterEvent.getWalletAddress();

  const utxos = await winterEvent.getUtxosByOutRef(job.data.utxos);

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(winterEvent, 6)
    : await winterEvent.getWalletUtxos();

  const completeTx = await winterEvent.spend(
    walletAddress,
    walletAddress,
    finalUtxos,
    utxos,
  );

  const signedTx = await winterEvent.signTx(completeTx);

  logger.debug(`Spend signed tx: ${signedTx}`);

  if (submit) {
    // return submitTx(signedTx);
    return await winterEvent.submitTx(signedTx);
  }
}

// export async function submitTx(signedTx: string): Promise<string> {
//   try {
//     const signedTxCbor = Buffer.from(signedTx, 'hex');

//     const response = await axios.post(TX_SUBMIT_API(), signedTxCbor, {
//       headers: {
//         'Content-Type': 'application/cbor',
//       },
//       responseType: 'text',
//     });

//     return response.data.toString().replace(/"/g, '');
//   } catch (error) {
//     logger.error('Error submitting transaction:', error.response.data);
//     throw error.response.data;
//   }
// }

async function getWalletUtxosWithRetry(
  winterEvent: EventFactory,
  maxAttempts: number,
): Promise<UTxO[]> {
  let walletUtxos: UTxO[];
  let finalUtxos: UTxO[];
  let attemptCount = 0;

  while (attemptCount < maxAttempts) {
    try {
      walletUtxos = await winterEvent.getWalletUtxos();
      finalUtxos = await getNonMempoolUtxos(walletUtxos);
      const lovelace = getTotalLovelace(finalUtxos);
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
