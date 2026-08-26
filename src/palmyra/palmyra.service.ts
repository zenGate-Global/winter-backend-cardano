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
  UtxoQuery,
} from '../types/job.dto.js';
import { BlockfrostProvider } from '@meshsdk/core';
import { buildMint, buildRecreate, buildSpend } from './palmyra.builder.js';
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
      // The dry run must use the same budgets as the real build, or a request
      // that the consumer will reject still returns 201.
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Blockfrost commodityDetails error: ${message}`);
      throw new BadGatewayException('Blockfrost API Error', {
        cause: error,
      });
    }
    try {
      return datums;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`datum decode error: ${message}`);
      throw new InternalServerErrorException('Datum Decode Error', {
        cause: error,
      });
    }
  }

  private async buildUtxoRef(
    contractAddresses: string[],
  ): Promise<
    Record<
      string,
      { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
    >
  > {
    const utxoRef: Record<
      string,
      { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
    > = {};
    for (const cA of contractAddresses) {
      try {
        const deployment =
          await this.deploymentService.getDeploymentByContractAddress(cA);
        utxoRef[cA] = {
          singletonScript: undefined,
          objectEventScript: {
            txHash: deployment.deploymentTxHash,
            outputIndex: deployment.deploymentOutputIndex,
          },
        };
      } catch (error) {
        this.logger.warn(
          `Deployment not found for contract address ${cA}: ${error}`,
        );
      }
    }
    return utxoRef;
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

  // A repeat of a request that carried the same `Idempotency-Key` resolves to
  // the same job identifier. A PENDING row can have no pg-boss job if the
  // process stopped after the row insert, so send its deterministic job again.
  private async alreadyAccepted<K extends TxQueueJobKind>(
    kind: K,
    data: TxQueueJobData<K>,
    incomingFingerprint: string | null,
  ): Promise<boolean> {
    const check = await this.findExistingCheck(data.id);
    if (!check) {
      return false;
    }
    this.assertMatchingFingerprint(check, incomingFingerprint);
    if (check.status === CheckStatus.PENDING) {
      await this.queue.enqueue(kind, data);
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
      const existing = await this.findExistingCheck(jobArguments.id);
      if (existing) {
        this.assertMatchingFingerprint(existing, requestFingerprint);
        if (existing.status !== CheckStatus.PENDING) {
          this.logger.log(
            `idempotent replay for ${jobArguments.id}, returning the existing job`,
          );
          return;
        }
      }

      const utxoPromises = jobArguments.utxos.map((utxo) =>
        this.provider.fetchUTxOs(utxo.txHash, utxo.outputIndex),
      );

      const fetchedUtxos = await Promise.all(utxoPromises);

      const contractAddresses = fetchedUtxos.map((utxoArray) => {
        const utxo = utxoArray?.[0];
        return utxo.output.address;
      });

      const utxoRef = await this.buildUtxoRef(contractAddresses);

      const jobArgumentsWithUtxoRef = { ...jobArguments, utxoRef: utxoRef };
      if (
        await this.alreadyAccepted(
          'spend-commodity',
          jobArgumentsWithUtxoRef,
          requestFingerprint,
        )
      ) {
        return;
      }
      await buildSpend(this.factory, { data: jobArgumentsWithUtxoRef }, false);
      await this.createCheckAndEnqueue(
        'spend-commodity',
        jobArgumentsWithUtxoRef,
        {
          id: jobArgumentsWithUtxoRef.id,
          type: CheckType.SPEND,
          status: CheckStatus.PENDING,
          requestFingerprint,
        },
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        `Spend Tx Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException('Spend Tx Failed', {
        cause: error,
      });
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
      await buildMint(this.factory, { data: jobArguments }, false);
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
      this.logger.error(
        `Mint Tx Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException('Mint Tx Failed', {
        cause: error,
      });
    }
  }

  async dispatchRecreateCommodity(
    jobArguments: recreateCommodityJob,
    requestFingerprint: string | null,
  ) {
    try {
      const existing = await this.findExistingCheck(jobArguments.id);
      if (existing) {
        this.assertMatchingFingerprint(existing, requestFingerprint);
        if (existing.status !== CheckStatus.PENDING) {
          this.logger.log(
            `idempotent replay for ${jobArguments.id}, returning the existing job`,
          );
          return;
        }
      }

      const utxoPromises = jobArguments.utxos.map((utxo) =>
        this.provider.fetchUTxOs(utxo.txHash, utxo.outputIndex),
      );

      const fetchedUtxos = await Promise.all(utxoPromises);

      const contractAddresses = fetchedUtxos.map((utxoArray) => {
        const utxo = utxoArray?.[0];
        return utxo.output.address;
      });

      const utxoRef = await this.buildUtxoRef(contractAddresses);

      const jobArgumentsWithUtxoRef = { ...jobArguments, utxoRef: utxoRef };
      if (
        await this.alreadyAccepted(
          'recreate-commodity',
          jobArgumentsWithUtxoRef,
          requestFingerprint,
        )
      ) {
        return;
      }
      await buildRecreate(
        this.factory,
        { data: jobArgumentsWithUtxoRef },
        false,
      );
      await this.createCheckAndEnqueue(
        'recreate-commodity',
        jobArgumentsWithUtxoRef,
        {
          id: jobArgumentsWithUtxoRef.id,
          type: CheckType.RECREATE,
          status: CheckStatus.PENDING,
          additionalInfo: {
            utxos: jobArgumentsWithUtxoRef.utxos,
            newDataReferences: jobArgumentsWithUtxoRef.newDataReferences,
            utxoRef: jobArgumentsWithUtxoRef.utxoRef,
          },
          requestFingerprint,
        },
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      this.logger.error(
        `Recreate Tx Failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException('Recreate Tx Failed', {
        cause: error,
      });
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
        } catch (lookupError) {
          throw new InternalServerErrorException('Check lookup failed', {
            cause: lookupError,
          });
        }
        if (!existing) {
          throw new InternalServerErrorException('Check lookup failed', {
            cause: error,
          });
        }
        this.assertMatchingFingerprint(
          existing,
          check.requestFingerprint ?? null,
        );
        if (existing.status === CheckStatus.PENDING) {
          await this.queue.enqueue(kind, data);
        }
        this.logger.log(
          `idempotent replay for ${data.id} lost the insert race, returning the existing job`,
        );
        return;
      }
      this.logger.error(
        `check create failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new InternalServerErrorException('Check persistence failed', {
        cause: error,
      });
    }

    try {
      await this.queue.enqueue(kind, data);
    } catch (error) {
      try {
        await this.checkDb.update(data.id, {
          status: CheckStatus.ERROR,
          error: `queue error: ${error instanceof Error ? error.message : String(error)}`,
        });
      } catch (updateError) {
        this.logger.error(
          `check update after queue failure failed: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
        );
        throw new InternalServerErrorException('Check persistence failed', {
          cause: updateError,
        });
      }
      throw error;
    }
  }

  // Postgres reports a unique or primary key violation as 23505. TypeORM wraps
  // the driver error, so check both the wrapper and the driver payload.
  private isDuplicateKey(error: unknown): boolean {
    const candidate = error as {
      code?: unknown;
      driverError?: { code?: unknown };
    };
    return (
      candidate?.code === '23505' || candidate?.driverError?.code === '23505'
    );
  }
}
