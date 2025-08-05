export interface spendCommodity {
  utxos: UtxoQuery[];
  utxoRef: Record<
    string,
    { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
  >;
}

export interface spendCommodityJob {
  id: string;
  utxos: UtxoQuery[];
  utxoRef: Record<
    string,
    { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
  >;
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

export interface deployRefCommodity {
  tokenName: string;
  deployAddress: string;
  utxoRef: UtxoQuery;
}

export interface deployRefCommodityJob {
  id: string;
  tokenName: string;
  deployAddress: string;
  utxoRef: UtxoQuery;
}

export interface tokenizeAndDeployRefCommodity {
  tokenName: string;
  metadataReference: string;
  deployAddress: string;
  utxoRef: UtxoQuery;
}

export interface tokenizeAndDeployRefCommodityJob {
  id: string;
  tokenName: string;
  metadataReference: string;
  deployAddress: string;
  utxoRef: UtxoQuery;
}

export interface recreateCommodity {
  utxos: UtxoQuery[];
  newDataReferences: string[];
  utxoRef: Record<
    string,
    { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
  >;
}

export interface recreateCommodityJob {
  id: string;
  utxos: UtxoQuery[];
  newDataReferences: string[];
  utxoRef: Record<
    string,
    { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
  >;
}

export interface UtxoQuery {
  txHash: string;
  outputIndex: number;
}
