import { EventFactory } from 'winter-cardano-mesh';
import {
  KOIOS_BASE_URL,
  NETWORK,
  TX_SUBMIT_API,
  ZENGATE_MNEMONIC,
} from '../constants';
import { IEvaluator, IFetcher, ISubmitter, UTxO } from '@meshsdk/core';
import { Job } from 'bull';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';
import { getNonMempoolUtxos, getTotalLovelace } from './palymra.utxo.service';
import axios from 'axios';
import { Logger } from '@nestjs/common';

const logger = new Logger('Builder');

export async function buildMint(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<tokenizeCommodityJob> | { data: tokenizeCommodityJob },
  submit: boolean,
): Promise<string | void> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const winterEvent = new EventFactory(NETWORK(), provider, {
    seed: ZENGATE_MNEMONIC(),
  });

  const walletAddress = await winterEvent.getWalletAddress();

  const walletAddressPK = winterEvent.getAddressPK(walletAddress);

  await winterEvent.setObjectContract({
    protocolVersion: BigInt(1),
    dataReference: Buffer.from(job.data.metadataReference, 'utf8').toString(
      'hex',
    ),
    eventCreationInfo: Buffer.from('', 'utf8').toString('hex'),
    signers: [walletAddressPK],
  });

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(winterEvent, 6)
    : await winterEvent.getWalletUtxos();

  const completeTx = await winterEvent.mintSingleton(
    job.data.tokenName,
    finalUtxos,
  );

  const signedTx = await winterEvent.signTx(completeTx);

  logger.debug(`Mint signed tx: ${signedTx}`);

  if (submit) {
    return submitTx(signedTx);
  }
}

export async function buildRecreate(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<recreateCommodityJob> | { data: recreateCommodityJob },
  submit: boolean,
): Promise<string | void> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const winterEvent = new EventFactory(NETWORK(), provider, {
    seed: ZENGATE_MNEMONIC(),
  });

  const walletAddress = await winterEvent.getWalletAddress();

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
    return submitTx(signedTx);
  }
}

export async function buildSpend(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<spendCommodityJob> | { data: spendCommodityJob },
  submit: boolean,
): Promise<string | void> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const winterEvent = new EventFactory(NETWORK(), provider, {
    seed: ZENGATE_MNEMONIC(),
  });

  const walletAddress = await winterEvent.getWalletAddress();

  const utxos = await winterEvent.getUtxosByOutRef(job.data.utxos);

  const finalUtxos = submit
    ? await getWalletUtxosWithRetry(winterEvent, 6)
    : await winterEvent.getWalletUtxos();

  const completeTx = await winterEvent.spend(
    walletAddress,
    walletAddress,
    finalUtxos,
    utxos,
    KOIOS_BASE_URL(),
  );

  const signedTx = await winterEvent.signTx(completeTx);

  logger.debug(`Spend signed tx: ${signedTx}`);

  if (submit) {
    return submitTx(signedTx);
  }
}

export async function submitTx(signedTx: string): Promise<string> {
  try {
    const signedTxCbor = Buffer.from(signedTx, 'hex');

    const response = await axios.post(TX_SUBMIT_API(), signedTxCbor, {
      headers: {
        'Content-Type': 'application/cbor',
      },
      responseType: 'text',
    });

    return response.data.toString().replace(/"/g, '');
  } catch (error) {
    logger.error('Error submitting transaction:', error.response.data);
    throw error.response.data;
  }
}

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
