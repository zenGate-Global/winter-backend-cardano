import {
  createInteractionContext,
  createMempoolMonitoringClient,
  MempoolMonitoring,
} from '@cardano-ogmios/client';
import {
  Transaction,
  TransactionOutputReference,
} from '@cardano-ogmios/schema';
import { Logger } from '@nestjs/common';
import { Asset, UTxO } from '@meshsdk/core';
import { BlockFrostAPI, Responses } from '@blockfrost/blockfrost-js';
import { BLOCKFROST_KEY } from 'src/constants';

export class UtxoService {

  private readonly logger = new Logger(UtxoService.name)
  private readonly bf: BlockFrostAPI

  constructor() {
    this.bf = new BlockFrostAPI({
      projectId: BLOCKFROST_KEY() as string
    })
  }

  async flushMempool(): Promise<Responses["mempool_tx_content"][]> {

    const transactions: { tx_hash: string }[] = [];
    let pagecount = 1
    
    while(true) {
      const tx = await this.bf.mempool({ page: pagecount})
      if (tx.length > 0 && tx.length < 100) {

        transactions.push(...tx);
      } else if (tx.length == 100) { // 100 is max page count.
        transactions.push(...tx);
        pagecount+=1; // Increase the page count to check a new page.
      } else { // Empty page, so no more results.
        break;
      }
    }
  
    const hashes = transactions.map(obj => obj.tx_hash)
    return Promise.all(hashes.map(async (h) => await this.bf.mempoolTx(h)))
  }
  
  async getUnconfirmedOutputs(
    addresses: string[],
  ): Promise<UTxO[]> {

    const unconfirmedOutputs: UTxO[] = [];
    const transactions = await this.flushMempool();

    for (const tx of transactions) {
      for (const [index, output] of tx.outputs.entries()) {
        if (addresses.includes(output.address)) {
          unconfirmedOutputs.push({
            input: {
              outputIndex: index,
              txHash: tx.tx.hash,
            },
            output: {
              address: output.address,
              amount: mapValueToAmount(output.amount),
              dataHash: output.data_hash ?? undefined,
              plutusData: output.inline_datum ?? undefined,
              scriptRef: output.reference_script_hash ?? undefined,
              scriptHash: undefined,
            },
          });
        }
      }
    }

    return unconfirmedOutputs;
  }

}

// export const createContext = () =>
//   createInteractionContext(
//     (err) => logger.error(err),
//     () => logger.log('Mempool Query Complete'),
//     { connection: {
//         address: {
//           http: "https://cardano-node-ogmios-preview-463523546.asia-southeast1.run.app",
//           webSocket: "wss://cardano-node-ogmios-preview-463523546.asia-southeast1.run.app",
//         },
//         //host: OGMIOS_HOST(),
//         //port: OGMIOS_PORT(), 
//         //tls: false,
//       } 
//     },
//   );


// async function flushMempool(
//   client: MempoolMonitoring.MempoolMonitoringClient,
// ): Promise<Transaction[]> {
//   const transactions: Transaction[] = [];

//   for (;;) {
//     const transaction = await client.nextTransaction({ fields: 'all' });
//     if (transaction !== null) {
//       transactions.push(transaction);
//     } else {
//       break;
//     }
//   }

//   return transactions;
// }

// export async function getUnconfirmedOutputs(
//   addresses: string[],
// ): Promise<UTxO[]> {

//   const unconfirmedOutputs: UTxO[] = [];
//   const transactions = await this.flushMempool();

//   for (const tx of transactions) {
//     for (const [index, output] of tx.outputs.entries()) {
//       if (addresses.includes(output.address)) {
//         unconfirmedOutputs.push({
//           input: {
//             outputIndex: index,
//             txHash: tx.id,
//           },
//           output: {
//             address: output.address,
//             amount: mapValueToAmount(output.value),
//             dataHash: output.datumHash,
//             plutusData: output.datum,
//             scriptRef: output.script?.cbor,
//             scriptHash: undefined,
//           },
//         });
//       }
//     }
//   }

//   return unconfirmedOutputs;
// }

export async function getUnconfirmedInputs(): Promise<
  TransactionOutputReference[]
> {
  const context = await createContext();
  const client = await createMempoolMonitoringClient(context);

  await client.acquireMempool();
  const transactions = await flushMempool(client);
  await client.shutdown();

  return transactions.map((t) => t.inputs).flat();
}

function mapValueToAmount(value) {
  const amount: Asset[] = [];

  // Map ADA (lovelace)
  if (value.ada && value.ada.lovelace) {
    amount.push({
      unit: 'lovelace',
      quantity: value.ada.lovelace.toString(),
    });
  }

  // Map other tokens
  for (const tokenId in value) {
    if (tokenId !== 'ada') {
      const policyId = tokenId.substring(0, 56);

      for (const tokenName in value[tokenId]) {
        amount.push({
          unit: `${policyId}${tokenName}`,
          quantity: value[tokenId][tokenName].toString(),
        });
      }
    }
  }

  return amount;
}

export async function getAllUtxOs(
  utxos: UTxO[],
  addresses: string[],
): Promise<UTxO[]> {
  const finalUtxos: UTxO[] = [...utxos];
  const unconfirmedUtxos: UTxO[] = await getUnconfirmedOutputs(addresses);
  const unconfirmedInputs: TransactionOutputReference[] =
    await getUnconfirmedInputs();

  const confirmedUtxos = finalUtxos.filter((utxo) => {
    return !unconfirmedInputs.some((input) => {
      return (
        input.transaction.id === utxo.input.txHash &&
        input.index === utxo.input.outputIndex
      );
    });
  });

  return [...confirmedUtxos, ...unconfirmedUtxos];
}

export async function getNonMempoolUtxos(utxos: UTxO[]) {
  const unconfirmedInputs: TransactionOutputReference[] =
    await getUnconfirmedInputs();
  return utxos.filter((utxo) => {
    return !unconfirmedInputs.some((input) => {
      return (
        input.transaction.id === utxo.input.txHash &&
        input.index === utxo.input.outputIndex
      );
    });
  });
}

export function getTotalLovelace(utxos: UTxO[]): bigint {
  return utxos.reduce(
    (acc, curr) => {
      const ada = curr.output.amount.find((a) => a.unit === 'lovelace');
      if (!ada) {
        throw new Error('Lovelace not found in UTxO');
      }
      return acc + BigInt(ada.quantity)
    },
    BigInt(0),
  );
}
