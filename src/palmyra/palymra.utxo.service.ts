import { Logger } from '@nestjs/common';
import { UTxO } from '@meshsdk/core';
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

    const transactions: Responses["mempool_content"] = await this.bf.mempoolAll();
   
    return Promise.all(transactions.map(async (obj) => await this.bf.mempoolTx(obj.tx_hash)));

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
              amount: output.amount,
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

  async getUnconfirmedInputs(): Promise<UTxO["input"][]> {

    const transactions = await this.flushMempool();

    return transactions.flatMap((tx) => tx.inputs).map((input) => {
      return {
        outputIndex: input.output_index,
        txHash: input.tx_hash
      }
    });
    
  }

  async getAllUtxos(utxos: UTxO[], addresses: string[]): Promise<UTxO[]> {
    const finalUtxos: UTxO[] = [...utxos];
    const unconfirmedUtxos: UTxO[] = await this.getUnconfirmedOutputs(addresses);
    const unconfirmedInputs: UTxO["input"][] = await this.getUnconfirmedInputs();

    const confirmedUtxos = finalUtxos.filter((utxo) => {
      return !unconfirmedInputs.some((input) => {
        return (input.outputIndex === utxo.input.outputIndex) && (input.txHash === utxo.input.txHash);
      });
    });

    return [...confirmedUtxos, ...unconfirmedUtxos];
  }

  async getNonMempoolUtxos(utxos: UTxO[]): Promise<UTxO[]> {
    const unconfirmedInputs: UTxO["input"][] = await this.getUnconfirmedInputs();
    return utxos.filter((utxo) => {
      return !unconfirmedInputs.some((input) => { 
        return (input.outputIndex === utxo.input.outputIndex) && (input.txHash === utxo.input.txHash);
      });
    });
  }

  getTotalLovelace(utxos: UTxO[]): bigint {
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

}