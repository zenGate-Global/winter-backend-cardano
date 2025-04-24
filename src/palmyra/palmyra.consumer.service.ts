import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';

import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';
import { BlockfrostProvider } from '@meshsdk/core';
import { buildMint, buildRecreate, buildSpend } from './palmyra.builder';
import { TransactionsService } from '../transactions/transactions.service';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckService } from '../check/check.service';
import { CheckStatus } from 'src/check/entities/check.entity';
import { EventFactory } from '@zengate/winter-cardano-mesh';
import { NETWORK, ZENGATE_MNEMONIC } from 'src/constants';

/* eslint-disable  @typescript-eslint/no-non-null-assertion */

@Processor('tx-queue')
export class PalmyraConsumerService {
  private readonly logger = new Logger(PalmyraConsumerService.name);
  private readonly provider: BlockfrostProvider;
  private readonly factory: EventFactory;
  constructor(
    private readonly checkDb: CheckService,
    private readonly db: TransactionsService,
    private configService: ConfigService,
  ) {
    this.provider = new BlockfrostProvider(
      this.configService.get('BLOCKFROST_KEY') as string,
    );
    this.factory = new EventFactory(
      NETWORK(),
      ZENGATE_MNEMONIC(),
      this.provider,
      this.provider,
    );
  }

  @Process({ name: '*', concurrency: 1 })
  async processJob(job: Job<unknown>): Promise<void> {
    switch (job.name) {
      case 'tokenize-commodity':
        await this.performUpdate(job);
        return this.tokenizeCommodity(job as Job<tokenizeCommodityJob>);
      case 'recreate-commodity':
        await this.performUpdate(job);
        return this.recreateCommodity(job as Job<recreateCommodityJob>);
      case 'spend-commodity':
        await this.performUpdate(job);
        return this.spendCommodity(job as Job<spendCommodityJob>);
    }
  }

  async performUpdate(job: Job<unknown>) {
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      await this.checkDb.update(job.data.id, {
        status: CheckStatus.QUEUED,
      });
    } catch (error) {
      this.logger.error(
        `failed to update status to queue in check db: ${JSON.stringify(
          error,
        )}`,
      );
    }
  }

  async tokenizeCommodity(job: Job<tokenizeCommodityJob>): Promise<void> {
    try {
      const txid = (await buildMint(this.factory, job, true)) as string;
      if (typeof txid !== 'string') {
        throw new Error(txid);
      }
      this.logger.log(`Mint successful: ${txid}`);
      await this.checkDb.update(job.data.id, {
        status: CheckStatus.SUCCESS,
        txid,
      });
      await this.db.create({ txid });
    } catch (error) {
      this.logger.error(`Error minting: ${error}`);
      await this.checkDb.update(job.data.id, {
        status: CheckStatus.ERROR,
        error: `minting error: ${JSON.stringify(error)}`,
      });
    }
  }

  async recreateCommodity(job: Job<recreateCommodityJob>): Promise<void> {
    try {
      const hash = (await buildRecreate(this.factory, job, true)) as string;
      if (typeof hash !== 'string') {
        throw new Error(hash);
      }
      await this.checkDb.update(job.data.id, {
        status: CheckStatus.SUCCESS,
        txid: hash,
      });
      this.logger.log(`Recreation successful: ${hash}`);
      for (const [index, u] of job.data.utxos.entries()) {
        await this.db.recreate(u.txHash, u.outputIndex, {
          recreated: {
            txHash: hash,
            outputIndex: index,
          },
        });
      }
    } catch (error) {
      this.logger.error(`Error recreating: ${error}`);
      await this.checkDb.update(job.data.id, {
        status: CheckStatus.ERROR,
        error: `recreating error: ${JSON.stringify(error)}`,
      });
    }
  }

  async spendCommodity(job: Job<spendCommodityJob>): Promise<void> {
    try {
      const hash = (await buildSpend(this.factory, job, true)) as string;
      if (typeof hash !== 'string') {
        throw new Error(hash);
      }
      await this.checkDb.update(job.data.id, {
        status: CheckStatus.SUCCESS,
        txid: hash,
      });
      this.logger.log(`Spend successful: ${hash}`);
      for (const u of job.data.utxos) {
        await this.db.spent(u.txHash, u.outputIndex, {
          spent: hash,
        });
      }
    } catch (error) {
      this.logger.error(`Error spending: ${error}`);
      await this.checkDb.update(job.data.id, {
        status: CheckStatus.ERROR,
        error: `spending error: ${JSON.stringify(error)}`,
      });
    }
  }
}
