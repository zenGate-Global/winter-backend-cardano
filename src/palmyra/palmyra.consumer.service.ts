import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';

import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeAndDeployRefCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';
import { BlockfrostProvider } from '@meshsdk/core';
import {
  buildDeployRef,
  buildMint,
  buildRecreate,
  buildSpend,
} from './palmyra.builder';
import { TransactionsService } from '../transactions/transactions.service';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckService } from '../check/check.service';
import { CheckStatus } from 'src/check/entities/check.entity';
import { DeploymentService } from '../deployment/deployment.service';
import { EventFactory } from '@zengate/winter-cardano-mesh';
import {
  NETWORK,
  ZENGATE_MNEMONIC,
  TRANSACTION_RETRY_ATTEMPTS,
} from 'src/constants';

/* eslint-disable  @typescript-eslint/no-non-null-assertion */

@Processor('tx-queue')
export class PalmyraConsumerService {
  private readonly logger = new Logger(PalmyraConsumerService.name);
  private readonly provider: BlockfrostProvider;
  private readonly factory: EventFactory;
  private readonly deployerAddress: string;
  constructor(
    private readonly checkDb: CheckService,
    private readonly db: TransactionsService,
    private readonly deploymentService: DeploymentService,
    private configService: ConfigService,
  ) {
    this.provider = new BlockfrostProvider(
      this.configService.get('BLOCKFROST_KEY') as string,
    );
    this.deployerAddress = this.configService.get('DEPLOYER_ADDRESS') as string;
    this.factory = new EventFactory(
      NETWORK(),
      ZENGATE_MNEMONIC(),
      this.provider,
      this.provider,
    );
  }

  private shouldRetryTransaction(hash: unknown): boolean {
    if (typeof hash !== 'string') {
      return true;
    }

    if (hash.toLowerCase().includes('bad request')) {
      return true;
    }

    return false;
  }

  private async retryBuildTransaction<T>(
    buildFunction: () => Promise<T>,
    maxAttempts: number = TRANSACTION_RETRY_ATTEMPTS(),
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await buildFunction();

        if (typeof result === 'string' && this.shouldRetryTransaction(result)) {
          this.logger.warn(
            `Attempt ${attempt}/${maxAttempts}: Invalid hash received: ${result}. Retrying...`,
          );
          if (attempt === maxAttempts) {
            throw new Error(
              `Transaction failed after ${maxAttempts} attempts. Last result: ${result}`,
            );
          }
          continue;
        }

        if (
          typeof result === 'object' &&
          result !== null &&
          'mintTxHash' in result
        ) {
          const mintResult = result as any;
          if (this.shouldRetryTransaction(mintResult.mintTxHash)) {
            this.logger.warn(
              `Attempt ${attempt}/${maxAttempts}: Invalid mint hash received: ${mintResult.mintTxHash}. Retrying...`,
            );
            if (attempt === maxAttempts) {
              throw new Error(
                `Transaction failed after ${maxAttempts} attempts. Last result: ${mintResult.mintTxHash}`,
              );
            }
            continue;
          }
        }

        if (
          typeof result === 'object' &&
          result !== null &&
          'deploymentTxHash' in result
        ) {
          const deployResult = result as any;
          if (this.shouldRetryTransaction(deployResult.deploymentTxHash)) {
            this.logger.warn(
              `Attempt ${attempt}/${maxAttempts}: Invalid deployment hash received: ${deployResult.deploymentTxHash}. Retrying...`,
            );
            if (attempt === maxAttempts) {
              throw new Error(
                `Transaction failed after ${maxAttempts} attempts. Last result: ${deployResult.deploymentTxHash}`,
              );
            }
            continue;
          }
        }

        if (attempt > 1) {
          this.logger.log(
            `Transaction succeeded on attempt ${attempt}/${maxAttempts}`,
          );
        }
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `Attempt ${attempt}/${maxAttempts} failed: ${lastError.message}`,
        );

        if (attempt === maxAttempts) {
          throw lastError;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error('Unknown error occurred during retry');
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
      const {
        mintTxHash: txid,
        inputUtxos,
        tokenName,
        singleton,
        contractAddress,
      } = (await this.retryBuildTransaction(() =>
        buildMint(this.factory, job, true),
      ))!;
      this.logger.log(
        `Mint successful with singleton: ${singleton} at txid: ${txid}`,
      );

      // Check if deployment already exists for this contract address
      const deploymentExists =
        await this.deploymentService.deploymentExistsByContractAddress(
          contractAddress,
        );

      if (!deploymentExists) {
        try {
          const deployJob = {
            ...job.data,
            deployAddress: this.deployerAddress,
            utxoRef: {
              txHash: inputUtxos[0].input.txHash,
              outputIndex: inputUtxos[0].input.outputIndex,
            },
          };

          const deploymentResult = (await this.retryBuildTransaction(() =>
            buildDeployRef(this.factory, { data: deployJob }, true),
          ))!;

          this.logger.log(
            `Deployment successful: ${deploymentResult.deploymentTxHash} at output index ${deploymentResult.deploymentOutputIndex}`,
          );

          await this.deploymentService.saveDeployment({
            contractAddress,
            deploymentTxHash: deploymentResult.deploymentTxHash,
            deploymentOutputIndex: deploymentResult.deploymentOutputIndex,
            deployAddress: deployJob.deployAddress,
          });
        } catch (error) {
          this.logger.error(`Error deploying: ${error}`);
        }
      } else {
        this.logger.log(
          `Deployment already exists for contract address: ${contractAddress}`,
        );
      }

      await this.checkDb.update(job.data.id, {
        status: CheckStatus.SUCCESS,
        txid,
      });
      await this.db.create({ txid });
    } catch (error) {
      this.logger.error(`Error minting: ${error}`);
      await this.checkDb.update(job.data.id, {
        status: CheckStatus.ERROR,
        error: `minting error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async recreateCommodity(job: Job<recreateCommodityJob>): Promise<void> {
    try {
      const hash = (await this.retryBuildTransaction(() =>
        buildRecreate(this.factory, job, true),
      )) as string;
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
        error: `recreating error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  async spendCommodity(job: Job<spendCommodityJob>): Promise<void> {
    try {
      const hash = (await this.retryBuildTransaction(() =>
        buildSpend(this.factory, job, true),
      )) as string;
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
        error: `spending error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}
