import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';
import { MaestroProvider } from '@meshsdk/core';
import { NETWORK } from '../constants';
import { buildMint, buildRecreate, buildSpend } from './palmyra.builder';
import { ConfigService } from '@nestjs/config';

/* eslint-disable  @typescript-eslint/no-non-null-assertion */

@Injectable()
export class PalmyraService {
  private readonly logger = new Logger(PalmyraService.name);
  constructor(
    @InjectQueue('tx-queue') private queue: Queue,
    private configService: ConfigService,
  ) {}

  private readonly provider = new MaestroProvider({
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    network: NETWORK(),
    apiKey: this.configService.get('MAESTRO_KEY'),
    turboSubmit: false,
  });
  async dispatchSpendCommodity(jobArguments: spendCommodityJob) {
    try {
      await buildSpend(this.provider, { data: jobArguments }, false);
      await this.queue.add('spend-commodity', jobArguments);
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Spend Tx Failed', {
        cause: error,
        description: JSON.stringify(error),
      });
    }
  }

  async dispatchTokenizeCommodity(jobArguments: tokenizeCommodityJob) {
    try {
      await buildMint(this.provider, { data: jobArguments }, false);
      await this.queue.add('tokenize-commodity', jobArguments);
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Mint Tx Failed', {
        cause: error,
        description: JSON.stringify(error),
      });
    }
  }

  async dispatchRecreateCommodity(jobArguments: recreateCommodityJob) {
    try {
      await buildRecreate(this.provider, { data: jobArguments }, false);
      await this.queue.add('recreate-commodity', jobArguments);
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Recreate Tx Failed', {
        cause: error,
        description: JSON.stringify(error),
      });
    }
  }
}
