import { Logger } from '@nestjs/common';
import { UTxO } from '@meshsdk/core';
import { BlockFrostAPI, Responses } from '@blockfrost/blockfrost-js';
import { BLOCKFROST_KEY } from 'src/constants';

export class UtxoService {
  private readonly logger = new Logger(UtxoService.name);
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
    try {
      const transactions: Responses['mempool_content'] =
        await this.bf.mempoolAll();
      return Promise.all(
        transactions.map(async (obj) => await this.bf.mempoolTx(obj.tx_hash)),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`flushMempool degraded: ${message}`);
      return [];
    }
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

  async getAllUtxos(utxos: UTxO[], addresses: string[]): Promise<UTxO[]> {
    const mempool = await this.flushMempool();
    const unconfirmedInputs = await this.getUnconfirmedInputs(mempool);
    const unconfirmedOutputs = await this.getUnconfirmedOutputs(addresses, mempool);

    const isSpent = (utxo: UTxO): boolean =>
      unconfirmedInputs.some(
        (input) =>
          input.outputIndex === utxo.input.outputIndex &&
          input.txHash === utxo.input.txHash,
      );

    const confirmedUtxos = utxos.filter((utxo) => !isSpent(utxo));
    const filteredUnconfirmedOutputs = unconfirmedOutputs.filter(
      (utxo) => !isSpent(utxo),
    );

    return [...confirmedUtxos, ...filteredUnconfirmedOutputs];
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
