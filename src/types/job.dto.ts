export interface spendCommodity {
  utxos: UtxoQuery[];
}

export interface spendCommodityJob {
  id: string;
  utxos: UtxoQuery[];
}

export interface tokenizeCommodity {
  tokenName: string;
  metadataReference: string;
}

export interface tokenizeCommodityJob {
  id: string;
  tokenName: string;
  metadataReference: string;
}

export interface recreateCommodity {
  utxos: UtxoQuery[];
  newDataReferences: string[];
}

export interface recreateCommodityJob {
  id: string;
  utxos: UtxoQuery[];
  newDataReferences: string[];
}

export interface UtxoQuery {
  txHash: string;
  outputIndex: number;
}
