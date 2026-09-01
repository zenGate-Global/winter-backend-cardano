import {
  BadGatewayException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto.js';
import { BlockfrostProvider } from '@meshsdk/core';
import { ConfigService } from '@nestjs/config';
import { CheckService } from '../check/check.service.js';
import { EventFactory, ObjectDatumFields } from '@zengate/winter-cardano-mesh';
import {
  Check,
  CheckStatus,
  CheckType,
} from '../check/entities/check.entity.js';
import { BLOCKFROST_KEY, NETWORK, ZENGATE_MNEMONIC } from 'src/constants';
import { DeploymentService } from '../deployment/deployment.service.js';
import { PalmyraQueueService } from './palmyra-queue.service.js';
import { TxQueueJobData, TxQueueJobKind } from './palmyra-queue.types.js';

@Injectable()
export class PalmyraService {
  private readonly logger = new Logger(PalmyraService.name);
  private readonly provider: BlockfrostProvider;
  private readonly factory: EventFactory;
  constructor(
    private readonly queue: PalmyraQueueService,
    private configService: ConfigService,
    private readonly checkDb: CheckService,
    private readonly deploymentService: DeploymentService,
  ) {
    this.provider = new BlockfrostProvider(BLOCKFROST_KEY());

    this.factory = new EventFactory(
      NETWORK(),
      ZENGATE_MNEMONIC(),
      this.provider,
      this.provider,
      this.provider,
    );
  }

  async getDataByTokenIds(tokenIds: string[]): Promise<ObjectDatumFields[]> {
    let datums: ObjectDatumFields[];
    try {
      datums = await Promise.all(
        tokenIds.map(async (id) => {
          const assetAddresses = await this.provider.fetchAssetAddresses(id);
          if (!assetAddresses.length) {
            throw new Error(`No holder address for asset ${id}`);
          }
          for (const entry of assetAddresses) {
            const utxos = await this.provider.fetchAddressUTxOs(
              entry.address,
              id,
            );
            const holder = utxos.find(
              (u) =>
                u.output.amount.some((a) => a.unit === id) &&
                !!u.output.plutusData,
            );
            if (holder && holder.output.plutusData) {
              return EventFactory.getObjectDatumFieldsFromPlutusCbor(
                holder.output.plutusData,
              );
            }
          }
          throw new Error(`UTxO with datum not found for asset ${id}`);
        }),
      );
    } catch (_error) {
      this.logger.error('Blockfrost commodityDetails request failed');
      throw new BadGatewayException('Blockfrost API Error');
    }
    return datums;
  }

  private async findExistingCheck(id: string): Promise<Check | null> {
    if (!(await this.checkDb.exists(id))) {
      return null;
    }
    return await this.checkDb.findOne(id);
  }

  private assertMatchingFingerprint(
    check: Check,
    incomingFingerprint: string | null,
  ): void {
    if (
      check.requestFingerprint != null &&
      incomingFingerprint != null &&
      check.requestFingerprint !== incomingFingerprint
    ) {
      throw new ConflictException(
        'Idempotency-Key already used for a different request body',
      );
    }
  }

  // A repeat of a request that carried the same key resolves to the same job.
  // A PENDING spend or recreate row needs script references before enqueue.
  private async enrichReplayData(
    data: spendCommodityJob | recreateCommodityJob,
  ): Promise<void> {
    data.utxoRef = await this.enrichUtxoRef(data.utxos, data.utxoRef);
  }

  private async enrichUtxoRef(
    utxos: spendCommodityJob['utxos'],
    existing: recreateCommodityJob['utxoRef'] = {},
  ): Promise<recreateCommodityJob['utxoRef']> {
    const fetched = await Promise.all(
      utxos.map((utxo) =>
        this.provider.fetchUTxOs(utxo.txHash, utxo.outputIndex),
      ),
    );
    const utxoRef: recreateCommodityJob['utxoRef'] = { ...existing };
    for (const result of fetched) {
      const address = result?.[0]?.output.address;
      if (!address) throw new Error('Requested UTxO was not found');
      if (address in utxoRef) continue;
      const deployment =
        await this.deploymentService.getLiveDeploymentByContractAddress(
          address,
        );
      utxoRef[address] = {
        singletonScript: undefined,
        objectEventScript: {
          txHash: deployment.deploymentTxHash,
          outputIndex: deployment.deploymentOutputIndex,
        },
      };
    }
    return utxoRef;
  }

  private async enqueueReplay<K extends TxQueueJobKind>(
    kind: K,
    data: TxQueueJobData<K>,
  ): Promise<void> {
    if (kind !== 'tokenize-commodity') {
      try {
        await this.enrichReplayData(
          data as spendCommodityJob | recreateCommodityJob,
        );
      } catch {
        this.logger.warn('Replay enrichment deferred');
      }
    }
    const refreshed = await this.findExistingCheck(data.id);
    if (refreshed?.status === CheckStatus.PENDING) {
      await this.queue.enqueue(kind, data);
    }
  }

  private async alreadyAccepted<K extends TxQueueJobKind>(
    kind: K,
    data: TxQueueJobData<K>,
    incomingFingerprint: string | null,
  ): Promise<boolean> {
    const check = await this.findExistingCheck(data.id);
    if (!check) return false;
    this.assertMatchingFingerprint(check, incomingFingerprint);
    if (check.status === CheckStatus.PENDING) {
      await this.enqueueReplay(kind, data);
    }
    this.logger.log(
      `idempotent replay for ${data.id}, returning the existing job`,
    );
    return true;
  }
  async dispatchSpendCommodity(
    jobArguments: spendCommodityJob,
    requestFingerprint: string | null,
  ) {
    try {
      // Enrichment belongs in the serialized worker; keep request thread free
      // of provider lookups and deterministic builds.
      if (
        await this.alreadyAccepted(
          'spend-commodity',
          jobArguments,
          requestFingerprint,
        )
      ) {
        return;
      }
      await this.createCheckAndEnqueue('spend-commodity', jobArguments, {
        id: jobArguments.id,
        type: CheckType.SPEND,
        status: CheckStatus.PENDING,
        requestFingerprint,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Spend Tx Failed');
      throw new BadGatewayException('Spend Tx Failed');
    }
  }

  async dispatchTokenizeCommodity(
    jobArguments: tokenizeCommodityJob,
    requestFingerprint: string | null,
  ) {
    if (
      await this.alreadyAccepted(
        'tokenize-commodity',
        jobArguments,
        requestFingerprint,
      )
    ) {
      return;
    }
    try {
      await this.createCheckAndEnqueue('tokenize-commodity', jobArguments, {
        id: jobArguments.id,
        type: CheckType.TOKENIZE,
        status: CheckStatus.PENDING,
        additionalInfo: {
          tokenName: jobArguments.tokenName,
          metadataReference: jobArguments.metadataReference,
        },
        requestFingerprint,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Mint Tx Failed');
      throw new BadGatewayException('Mint Tx Failed');
    }
  }

  async dispatchRecreateCommodity(
    jobArguments: recreateCommodityJob,
    requestFingerprint: string | null,
  ) {
    try {
      if (
        await this.alreadyAccepted(
          'recreate-commodity',
          jobArguments,
          requestFingerprint,
        )
      ) {
        return;
      }
      await this.createCheckAndEnqueue('recreate-commodity', jobArguments, {
        id: jobArguments.id,
        type: CheckType.RECREATE,
        status: CheckStatus.PENDING,
        additionalInfo: {
          utxos: jobArguments.utxos,
          newDataReferences: jobArguments.newDataReferences,
          utxoRef: jobArguments.utxoRef,
        },
        requestFingerprint,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Recreate Tx Failed');
      throw new BadGatewayException('Recreate Tx Failed');
    }
  }

  private async createCheckAndEnqueue<K extends TxQueueJobKind>(
    kind: K,
    data: TxQueueJobData<K>,
    check: Parameters<CheckService['create']>[0],
  ): Promise<void> {
    try {
      await this.checkDb.create(check);
    } catch (error) {
      // Two requests carrying the same idempotency key can both pass the
      // pre-check, so the primary key is the real serialization point. A
      // conflict means the other request already accepted this job.
      if (this.isDuplicateKey(error)) {
        let existing: Check | null;
        try {
          existing = await this.findExistingCheck(data.id);
        } catch {
          throw new InternalServerErrorException('Check lookup failed');
        }
        if (!existing) {
          throw new InternalServerErrorException('Check lookup failed');
        }
        this.assertMatchingFingerprint(
          existing,
          check.requestFingerprint ?? null,
        );
        if (existing.status === CheckStatus.PENDING) {
          await this.enqueueReplay(kind, data);
        }
        this.logger.log(
          `idempotent replay for ${data.id} lost the insert race, returning the existing job`,
        );
        return;
      }
      this.logger.error('check create failed');
      throw new InternalServerErrorException('Check persistence failed');
    }

    try {
      await this.queue.enqueue(kind, data);
    } catch (error) {
      try {
        await this.checkDb.update(data.id, {
          status: CheckStatus.ERROR,
          error: 'queue dispatch failed',
        });
      } catch {
        this.logger.error('check update after queue failure failed');
        throw new InternalServerErrorException('Check persistence failed');
      }
      throw error;
    }
  }

  // Postgres reports a unique or primary key violation as 23505. TypeORM wraps
  // the driver error, so check both the wrapper and the driver payload.
  private isDuplicateKey(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    if ('code' in error && (error as Record<string, unknown>).code === '23505')
      return true;
    if (
      'driverError' in error &&
      typeof (error as Record<string, unknown>).driverError === 'object' &&
      (error as Record<string, unknown>).driverError !== null &&
      'code' in
        ((error as Record<string, unknown>).driverError as Record<
          string,
          unknown
        >) &&
      (
        (error as Record<string, unknown>).driverError as Record<
          string,
          unknown
        >
      ).code === '23505'
    )
      return true;
    return false;
  }
}
