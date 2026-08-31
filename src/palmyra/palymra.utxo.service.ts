import { UTxO } from '@meshsdk/core';
import { BlockFrostAPI, Responses } from '@blockfrost/blockfrost-js';
import { BLOCKFROST_KEY } from 'src/constants';

export class UtxoService {
  private readonly bf: BlockFrostAPI;

  constructor() {
    const key = BLOCKFROST_KEY() as string;
    if (key.startsWith('http')) {
      // ponytail: devnet override via customBackend, yaci seam
      this.bf = new BlockFrostAPI({
        projectId: 'devnet',
        customBackend: key,
      });
    } else {
      this.bf = new BlockFrostAPI({
        projectId: key,
      });
    }
  }

  async flushMempool(): Promise<Responses['mempool_tx_content'][]> {
    const transactions: Responses['mempool_content'] =
      await this.bf.mempoolAll();
    return Promise.all(
      transactions.map(async (obj) => await this.bf.mempoolTx(obj.tx_hash)),
    );
  }

  async getUnconfirmedOutputs(
    addresses: string[],
    mempool: Responses['mempool_tx_content'][],
  ): Promise<UTxO[]> {
    const unconfirmedOutputs: UTxO[] = [];
    for (const tx of mempool) {
      for (const [index, output] of tx.outputs.entries()) {
        if (addresses.includes(output.address)) {
          unconfirmedOutputs.push({
            input: {
              outputIndex: index,
              txHash: tx.tx.hash,
            },
            output: {
              address: output.address,
              amount: output.amount,
              dataHash: output.data_hash ?? undefined,
              plutusData: output.inline_datum ?? undefined,
              scriptRef: undefined,
              scriptHash: output.reference_script_hash ?? undefined,
            },
          });
        }
      }
    }
    return unconfirmedOutputs;
  }

  async getUnconfirmedInputs(
    mempool: Responses['mempool_tx_content'][],
  ): Promise<UTxO['input'][]> {
    return mempool
      .flatMap((tx) => tx.inputs)
      .map((input) => {
        return {
          outputIndex: input.output_index,
          txHash: input.tx_hash,
        };
      });
  }

  // The only funding partition. It never merges the two sets, because a
  // mempool-only input cannot be resolved by the remote evaluator and the
  // collateral selector picks the largest pure-ADA UTxO it can see.
  async getUtxoSets(
    utxos: UTxO[],
    addresses: string[],
    mempool: Responses['mempool_tx_content'][],
  ): Promise<{ confirmed: UTxO[]; unconfirmed: UTxO[] }> {
    const unconfirmedInputs = await this.getUnconfirmedInputs(mempool);
    const unconfirmedOutputs = await this.getUnconfirmedOutputs(
      addresses,
      mempool,
    );

    const isSpent = (utxo: UTxO): boolean =>
      unconfirmedInputs.some(
        (input) =>
          input.outputIndex === utxo.input.outputIndex &&
          input.txHash === utxo.input.txHash,
      );

    const confirmed = utxos.filter((utxo) => !isSpent(utxo));
    const unconfirmed = unconfirmedOutputs.filter((utxo) => !isSpent(utxo));

    return { confirmed, unconfirmed };
  }

  getTotalLovelace(utxos: UTxO[]): bigint {
    return utxos.reduce((acc, curr) => {
      const ada = curr.output.amount.find((a) => a.unit === 'lovelace');
      if (!ada) {
        throw new Error('Lovelace not found in UTxO');
      }
      return acc + BigInt(ada.quantity);
    }, BigInt(0));
  }
}
