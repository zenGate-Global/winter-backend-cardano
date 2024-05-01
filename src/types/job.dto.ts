export interface spendCommodityJob {
  utxos: UtxoQuery[];
}

export interface tokenizeCommodityJob {
  tokenName: string;
  metadataReference: string;
}

export interface recreateCommodityJob {
  utxos: UtxoQuery[];
  newDataReferences: string[];
}

export interface UtxoQuery {
  txHash: string;
  outputIndex: number;
}
