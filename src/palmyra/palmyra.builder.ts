import { EventFactory } from 'winter-cardano-mesh';
import { NETWORK, ZENGATE_MNEMONIC } from '../constants';
import { IEvaluator, IFetcher, ISubmitter } from '@meshsdk/core';
import { Job } from 'bull';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';

export async function buildMint(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<tokenizeCommodityJob> | { data: tokenizeCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const winterEvent = new EventFactory(NETWORK(), provider, {
    seed: ZENGATE_MNEMONIC(),
  });

  const walletAddressPK = winterEvent.getAddressPK(
    await winterEvent.getWalletAddress(),
  );

  await winterEvent.setObjectContract({
    protocolVersion: BigInt(1),
    dataReference: Buffer.from(job.data.metadataReference, 'utf8').toString(
      'hex',
    ),
    eventCreationInfo: Buffer.from('', 'utf8').toString('hex'),
    signers: [walletAddressPK],
  });

  const walletUtxos = await winterEvent.getWalletUtxos();

  const completeTx = await winterEvent.mintSingleton(
    job.data.tokenName,
    walletUtxos,
  );

  const signedTx = await winterEvent.signTx(completeTx);

  if (submit) {
    const txHash = await winterEvent.submitTx(signedTx);
    return txHash;
  }
}

export async function buildRecreate(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<recreateCommodityJob> | { data: recreateCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const winterEvent = new EventFactory(NETWORK(), provider, {
    seed: ZENGATE_MNEMONIC(),
  });

  const walletUtxos = await winterEvent.getWalletUtxos();
  const utxos = await winterEvent.getUtxosByOutRef(job.data.utxos);

  console.log(JSON.stringify(utxos));

  const completeTx = await winterEvent.recreate(
    await winterEvent.getWalletAddress(),
    walletUtxos,
    utxos,
    job.data.newDataReferences.map((d) =>
      Buffer.from(d, 'utf8').toString('hex'),
    ),
  );

  const signedTx = await winterEvent.signTx(completeTx);

  if (submit) {
    try {
      const txHash = await winterEvent.submitTx(signedTx);
      return txHash;
    } catch (error) {
      console.log(error);
    }
  }
}

export async function buildSpend(
  provider: IFetcher & ISubmitter & IEvaluator,
  job: Job<spendCommodityJob> | { data: spendCommodityJob },
  submit: boolean,
): Promise<string | void> {
  const winterEvent = new EventFactory(NETWORK(), provider, {
    seed: ZENGATE_MNEMONIC(),
  });

  const walletUtxos = await winterEvent.getWalletUtxos();
  const utxos = await winterEvent.getUtxosByOutRef(job.data.utxos);

  const completeTx = await winterEvent.spend(
    await winterEvent.getWalletAddress(),
    await winterEvent.getWalletAddress(),
    walletUtxos,
    utxos,
    'https://preprod.koios.rest/api/v1',
  );

  const signedTx = await winterEvent.signTx(completeTx);

  if (submit) {
    const txHash = await winterEvent.submitTx(signedTx);
    console.log(txHash);
    return txHash;
  }
}
