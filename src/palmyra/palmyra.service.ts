import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
  UtxoQuery,
} from '../types/job.dto.js';
import { BlockfrostProvider } from '@meshsdk/core';
import { buildMint, buildRecreate, buildSpend } from './palmyra.builder.js';
import { ConfigService } from '@nestjs/config';
import { CheckService } from '../check/check.service.js';
import { EventFactory, ObjectDatumFields } from '@zengate/winter-cardano-mesh';
import { CheckStatus, CheckType } from '../check/entities/check.entity.js';
import { NETWORK, ZENGATE_MNEMONIC } from 'src/constants';
import { DeploymentService } from '../deployment/deployment.service.js';

@Injectable()
export class PalmyraService {
  private readonly logger = new Logger(PalmyraService.name);
  private readonly provider: BlockfrostProvider;
  private readonly factory: EventFactory;
  constructor(
    @InjectQueue('tx-queue') private queue: Queue,
    private configService: ConfigService,
    private readonly checkDb: CheckService,
    private readonly deploymentService: DeploymentService,
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

  async getDataByTokenIds(tokenIds: string[]): Promise<ObjectDatumFields[]> {
    let datums: string[];
    try {
      // datums = (await this.koios.assetUtxos(tokenIds)).map(
      //   (utxo) => utxo.inline_datum.bytes,
      // );
      datums = await Promise.all(
        tokenIds.map(async (id) => await this.factory.getScriptInfo(id)),
      );
    } catch (error) {
      this.logger.error(`Blockfrost getScriptInfo error: ${error}`);
      throw new BadRequestException({
        message: 'Blockfrost API Error',
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
      const utxoPromises = jobArguments.utxos.map(utxo => 
        this.provider.fetchUTxOs(utxo.txHash, utxo.outputIndex)
      );
      
      const fetchedUtxos = await Promise.all(utxoPromises);
      
      const contractAddresses = fetchedUtxos.map((utxoArray) => {
        const utxo = utxoArray?.[0];
        return utxo.output.address;
      });
      
      const utxoRef: Record<string, {singletonScript: UtxoQuery | undefined, objectEventScript: UtxoQuery}> = {};

      for (const cA of contractAddresses) {
        try {
          const deployment = await this.deploymentService.getDeploymentByContractAddress(cA);
          utxoRef[cA] = {
            singletonScript: undefined,
            objectEventScript: {
              txHash: deployment.deploymentTxHash,
              outputIndex: deployment.deploymentOutputIndex,
            },
          };
        } catch (error) {
          this.logger.warn(`Deployment not found for contract address ${cA}: ${error}`);
        }
      }

      const jobArgumentsWithUtxoRef = { ...jobArguments, utxoRef: utxoRef };

      await buildSpend(this.factory, { data: jobArgumentsWithUtxoRef }, false);
      await this.queue.add('spend-commodity', jobArgumentsWithUtxoRef);
      await this.checkDb.create({
        id: jobArgumentsWithUtxoRef.id,
        type: CheckType.SPEND,
        status: CheckStatus.PENDING,
      });
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Spend Tx Failed', {
        cause: error,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async dispatchTokenizeCommodity(jobArguments: tokenizeCommodityJob) {
    try {
      await buildMint(this.factory, { data: jobArguments }, false);
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
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async dispatchRecreateCommodity(jobArguments: recreateCommodityJob) {
    try {

      const utxoPromises = jobArguments.utxos.map(utxo => 
        this.provider.fetchUTxOs(utxo.txHash, utxo.outputIndex)
      );
      
      const fetchedUtxos = await Promise.all(utxoPromises);
      
      const contractAddresses = fetchedUtxos.map((utxoArray) => {
        const utxo = utxoArray?.[0];
        return utxo.output.address;
      });
      
      const utxoRef: Record<string, {singletonScript: UtxoQuery | undefined, objectEventScript: UtxoQuery}> = {};

      for (const cA of contractAddresses) {
        try {
          const deployment = await this.deploymentService.getDeploymentByContractAddress(cA);
          utxoRef[cA] = {
            singletonScript: undefined,
            objectEventScript: {
              txHash: deployment.deploymentTxHash,
              outputIndex: deployment.deploymentOutputIndex,
            },
          };
        } catch (error) {
          this.logger.warn(`Deployment not found for contract address ${cA}: ${error}`);
        }
      }

      const jobArgumentsWithUtxoRef = { ...jobArguments, utxoRef: utxoRef };
      await buildRecreate(this.factory, { data: jobArgumentsWithUtxoRef }, false);
      await this.queue.add('recreate-commodity', jobArgumentsWithUtxoRef);
      await this.checkDb.create({
        id: jobArgumentsWithUtxoRef.id,
        type: CheckType.RECREATE,
        status: CheckStatus.PENDING,
        additionalInfo: {
          utxos: jobArgumentsWithUtxoRef.utxos,
          newDataReferences: jobArgumentsWithUtxoRef.newDataReferences,
          utxoRef: jobArgumentsWithUtxoRef.utxoRef,
        },
      });
    } catch (error) {
      this.logger.error(error);
      throw new BadRequestException('Recreate Tx Failed', {
        cause: error,
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
