import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto.js';

export const TX_QUEUE_NAME = 'tx-queue';

export type TxQueueJob =
  | {
      kind: 'tokenize-commodity';
      data: tokenizeCommodityJob;
    }
  | {
      kind: 'recreate-commodity';
      data: recreateCommodityJob;
    }
  | {
      kind: 'spend-commodity';
      data: spendCommodityJob;
    };

export type TxQueueJobKind = TxQueueJob['kind'];
export type TxQueueJobData<K extends TxQueueJobKind> = Extract<
  TxQueueJob,
  { kind: K }
>['data'];
