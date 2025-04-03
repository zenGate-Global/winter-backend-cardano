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
import { CheckService } from '../check/check.service';
import { EventFactory, Koios, ObjectDatumFields } from 'winter-cardano-mesh';
import { CheckStatus, CheckType } from '../check/entities/check.entity';

/* eslint-disable  @typescript-eslint/no-non-null-assertion */

@Injectable()
export class PalmyraService {
  private readonly logger = new Logger(PalmyraService.name);
  constructor(
    @InjectQueue('tx-queue') private queue: Queue,
    private configService: ConfigService,
    private readonly checkDb: CheckService,
  ) {}

  private readonly provider = new MaestroProvider({
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    network: NETWORK(),
    apiKey: this.configService.get('MAESTRO_KEY'),
    turboSubmit: false,
  });

  private readonly koios = new Koios(this.configService.get('KOIOS_BASE_URL'));

  async getDataByTokenIds(tokenIds: string[]): Promise<ObjectDatumFields[]> {
    let datums: string[];
    try {
      datums = (await this.koios.assetUtxos(tokenIds)).map(
        (utxo) => utxo.inline_datum.bytes,
      );
    } catch (error) {
      this.logger.error(`koios api error: ${error}`);
      throw new BadRequestException({
        message: 'Koios API Error',
        cause: error.message,
      });
    }
    try {
      return datums.map((d: string) =>
        EventFactory.getObjectDatumFieldsFromPlutusCbor(d),
      );
    } catch (error) {
      this.logger.error(`datum decode error: ${error}`);
      throw new BadRequestException({
        message: 'Datum Decode Error',
        cause: error.message,
      });
    }
  }
  async dispatchSpendCommodity(jobArguments: spendCommodityJob) {
    try {
      await buildSpend(this.provider, { data: jobArguments }, false);
      await this.queue.add('spend-commodity', jobArguments);
      await this.checkDb.create({
        id: jobArguments.id,
        type: CheckType.SPEND,
        status: CheckStatus.PENDING,
      });
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
      await this.checkDb.create({
        id: jobArguments.id,
        type: CheckType.TOKENIZE,
        status: CheckStatus.PENDING,
        additionalInfo: {
          tokenName: jobArguments.tokenName,
          metadataReference: jobArguments.metadataReference,
        },
      });
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
      await this.checkDb.create({
        id: jobArguments.id,
        type: CheckType.RECREATE,
        status: CheckStatus.PENDING,
        additionalInfo: {
          utxos: jobArguments.utxos,
          newDataReferences: jobArguments.newDataReferences,
        },
      });
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Recreate Tx Failed', {
        cause: error,
        description: JSON.stringify(error),
      });
    }
  }
}
