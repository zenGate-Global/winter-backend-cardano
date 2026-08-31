import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
  UtxoQuery,
} from '../types/job.dto';
import {
  BlockfrostProvider,
  resolveScriptHash,
  resolveTxHash,
  TxParser,
  UTxO,
} from '@meshsdk/core';
import {
  buildDeployRef,
  buildMint,
  buildRecreate,
  buildSpend,
} from './palmyra.builder';
import { TransactionsService } from '../transactions/transactions.service';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CheckService } from '../check/check.service';
import { CheckStatus } from 'src/check/entities/check.entity';
import { DeploymentService } from '../deployment/deployment.service';
import { EventFactory } from '@zengate/winter-cardano-mesh';
import {
  BLOCKFROST_KEY,
  NETWORK,
  ZENGATE_MNEMONIC,
  TRANSACTION_RETRY_ATTEMPTS,
} from 'src/constants';
import { TxQueueJob } from './palmyra-queue.types.js';
import { CSLSerializer } from '@meshsdk/core-csl';
import { NoConfirmedFundingUtxoError } from './no-confirmed-funding-utxo.error';
import { InsufficientConfirmedFundingError } from './insufficient-confirmed-funding.error';

type StoredDeployment = {
  signedTx: string;
  txid: string;
  outputIndex: number;
  contractAddress: string;
  deployAddress: string;
};

type ExistingTx =
  | { kind: 'none' | 'reconciliation' }
  | {
      kind: 'existing';
      txid: string;
      signedTx: string;
      storedSignedTx: string;
      deployment?: StoredDeployment;
    };

@Injectable()
export class PalmyraConsumerService {
  private readonly logger = new Logger(PalmyraConsumerService.name);
  private readonly provider: BlockfrostProvider;
  private readonly factory: EventFactory;
  private readonly deployerAddress: string;
  private readonly objectEventScriptHash: string;
  constructor(
    private readonly checkDb: CheckService,
    private readonly db: TransactionsService,
    private readonly deploymentService: DeploymentService,
    private configService: ConfigService,
  ) {
    this.provider = new BlockfrostProvider(BLOCKFROST_KEY());
    this.deployerAddress = this.configService.get('DEPLOYER_ADDRESS') as string;
    this.factory = new EventFactory(
      NETWORK(),
      ZENGATE_MNEMONIC(),
      this.provider,
      this.provider,
      this.provider,
    );
    this.objectEventScriptHash = resolveScriptHash(
      this.factory.objectEventContract.code,
      this.factory.objectEventContract.version,
    );
  }

  private isAmbiguousSubmitError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    const statusMatch = msg.match(/"status"\s*:\s*(\d{3})/);
    if (statusMatch) {
      const status = Number(statusMatch[1]);
      if (status >= 500 && status < 600) return true;
    }
    if (
      /timeout|timed out|ETIMEDOUT|ECONN|socket|EAI_AGAIN|ENOTFOUND|ECONNRESET/i.test(
        msg,
      )
    )
      return true;
    return false;
  }

  private isNotFound(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      /"status(?:_code)?"\s*:\s*404/.test(message) ||
      /has not been found/i.test(message)
    );
  }

  private storedErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
      const providerError = error as {
        name?: unknown;
        status_code?: unknown;
        code?: unknown;
      };
      const code = providerError.code;
      if (
        providerError.name === 'BlockfrostClientError' ||
        providerError.name === 'BlockfrostServerError' ||
        typeof providerError.status_code === 'number' ||
        (typeof code === 'string' &&
          (code.startsWith('ECONN') ||
            code === 'ETIMEDOUT' ||
            code === 'EHOSTUNREACH' ||
            code === 'ENETUNREACH' ||
            code === 'EPIPE' ||
            code === 'EAI_AGAIN' ||
            code === 'ENOTFOUND' ||
            code === 'ERR_GOT_REQUEST_ERROR'))
      ) {
        return 'provider request failed';
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/"status(?:_code)?"\s*:\s*\d{3}/.test(message)) {
      return 'provider request failed';
    }
    return message;
  }

  private isTransientBuildError(error: unknown): boolean {
    if (
      error instanceof NoConfirmedFundingUtxoError ||
      error instanceof InsufficientConfirmedFundingError
    )
      return true;
    if (error && typeof error === 'object') {
      const statusCode = (error as { status_code?: unknown }).status_code;
      if (
        typeof statusCode === 'number' &&
        (statusCode === 429 || (statusCode >= 500 && statusCode < 600))
      )
        return true;

      if ((error as { name?: unknown }).name === 'BlockfrostClientError') {
        return true;
      }
      const transportCode = (error as { code?: unknown }).code;
      if (
        typeof transportCode === 'string' &&
        (transportCode.startsWith('ECONN') ||
          transportCode === 'ETIMEDOUT' ||
          transportCode === 'EHOSTUNREACH' ||
          transportCode === 'ENETUNREACH' ||
          transportCode === 'EPIPE' ||
          transportCode === 'EAI_AGAIN' ||
          transportCode === 'ENOTFOUND' ||
          transportCode === 'ERR_GOT_REQUEST_ERROR')
      )
        return true;
    }
    const msg = error instanceof Error ? error.message : String(error);
    const serializedStatus = msg.match(/"status(?:_code)?"\s*:\s*(\d{3})/);
    if (serializedStatus) {
      const statusCode = Number(serializedStatus[1]);
      if (statusCode === 429 || (statusCode >= 500 && statusCode < 600)) {
        return true;
      }
    }
    if (/"status(?:_code)?"\s*:\s*404/.test(msg)) return true;
    if (/has not been found/i.test(msg)) return true;
    if (/evaluate redeemers failed|tx evaluation fail/i.test(msg)) return true;
    if (/insufficient collateral/i.test(msg)) return true;
    return this.isAmbiguousSubmitError(error);
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

  private extractHash(result: unknown): string | undefined {
    if (typeof result === 'string') return result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (typeof r['mintTxHash'] === 'string') return r['mintTxHash'] as string;
      if (typeof r['deploymentTxHash'] === 'string')
        return r['deploymentTxHash'] as string;
      if (typeof r['hash'] === 'string') return r['hash'] as string;
    }
    return undefined;
  }

  private async retryBuildTransaction<T>(
    buildFunction: () => Promise<T>,
    maxAttempts: number = TRANSACTION_RETRY_ATTEMPTS(),
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await buildFunction();
        const hash = this.extractHash(result);
        if (hash !== undefined && this.shouldRetryTransaction(hash)) {
          this.logger.warn(
            `Attempt ${attempt}/${maxAttempts}: Invalid hash received: ${hash}. Retrying...`,
          );
          if (attempt === maxAttempts) {
            throw new Error(
              `Transaction failed after ${maxAttempts} attempts. Last result: ${hash}`,
            );
          }
          continue;
        }
        if (attempt > 1) {
          this.logger.log(
            `Transaction succeeded on attempt ${attempt}/${maxAttempts}`,
          );
        }
        return result;
      } catch (error) {
        if (error instanceof NoConfirmedFundingUtxoError) {
          this.logger.warn(
            `No confirmed funding UTxO: ${error.confirmedCount} confirmed, ${error.unconfirmedCount} unconfirmed`,
          );
          throw error;
        }
        if (error instanceof InsufficientConfirmedFundingError) {
          this.logger.warn(error.message);
          throw error;
        }
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
    throw lastError ?? new Error('Unknown error occurred during retry');
  }

  async processJob(job: TxQueueJob): Promise<void> {
    switch (job.kind) {
      case 'tokenize-commodity':
        await this.performUpdate(job);
        return this.tokenizeCommodity(job.data);
      case 'recreate-commodity':
        await this.performUpdate(job);
        return this.recreateCommodity(job.data);
      case 'spend-commodity':
        await this.performUpdate(job);
        return this.spendCommodity(job.data);
      default: {
        const unknownJob = job as unknown as { kind?: unknown };
        const message = `Unknown tx queue job kind: ${String(unknownJob.kind)}`;
        this.logger.error(message);
        throw new Error(message);
      }
    }
  }

  async performUpdate(job: TxQueueJob) {
    try {
      const check = await this.checkDb.findOne(job.data.id);
      if (
        check.status === CheckStatus.SUCCESS ||
        check.status === CheckStatus.CONFIRMED ||
        check.status === CheckStatus.SUBMITTED
      )
        return;
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

  private decodeStoredTx(value: string): {
    signedTx: string;
    deployment?: StoredDeployment;
  } {
    if (!value.startsWith('{')) return { signedTx: value };
    const stored = JSON.parse(value) as {
      signedTx?: unknown;
      deployment?: StoredDeployment;
    };
    if (typeof stored.signedTx !== 'string') {
      throw new Error('Stored transaction is malformed');
    }
    return {
      signedTx: stored.signedTx,
      deployment: stored.deployment,
    };
  }

  private encodeStoredTx(
    signedTx: string,
    deployment: StoredDeployment,
  ): string {
    return JSON.stringify({ signedTx, deployment });
  }

  private async handleExistingTx(id: string): Promise<ExistingTx> {
    let check;
    try {
      check = await this.checkDb.findOne(id);
    } catch (error) {
      if (error instanceof NotFoundException) return { kind: 'none' };
      throw error;
    }
    if (!check.txid) return { kind: 'none' };
    if (!check.signedTx) {
      const message = 'missing signedTx for reconciliation';
      this.logger.error(
        `Check ${id} has txid but no signedTx, needs reconciliation`,
      );
      await this.checkDb.update(id, {
        ...(check.status === CheckStatus.SUCCESS ||
        check.status === CheckStatus.CONFIRMED ||
        check.status === CheckStatus.SUBMITTED
          ? {}
          : { status: CheckStatus.ERROR }),
        error: message,
      });
      return { kind: 'reconciliation' };
    }

    // Never rebuild a row that already has txid plus signedTx. The stored
    // transaction is the exact bytes that were submitted; rebuilding would
    // select different wallet UTxOs and mint a second token.
    const stored = this.decodeStoredTx(check.signedTx);
    return {
      kind: 'existing',
      txid: check.txid,
      signedTx: stored.signedTx,
      storedSignedTx: check.signedTx,
      deployment: stored.deployment,
    };
  }

  private async enrichUtxoRef(
    utxos: UtxoQuery[],
  ): Promise<
    Record<
      string,
      { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
    >
  > {
    if (!utxos.length) return {};
    const fetched = await Promise.all(
      utxos.map((u) => this.provider.fetchUTxOs(u.txHash, u.outputIndex)),
    );
    const contractAddresses = fetched.map(
      (arr) => arr?.[0]?.output.address ?? '',
    );
    const utxoRef: Record<
      string,
      { singletonScript: UtxoQuery | undefined; objectEventScript: UtxoQuery }
    > = {};
    for (const cA of contractAddresses) {
      if (!cA) continue;
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

  private async submitWithHashCheck(
    id: string,
    signedTx: string,
    expectedTxid: string,
    storedSignedTx = signedTx,
  ): Promise<void> {
    const expected = expectedTxid.toLowerCase();
    const computed = resolveTxHash(signedTx).toLowerCase();
    if (computed !== expected) {
      throw new Error(
        `expected txid ${expected} does not match computed ${computed}`,
      );
    }
    let returned: string;
    try {
      const result = await this.factory.submitTx(signedTx);
      returned =
        typeof result === 'string'
          ? result.toLowerCase()
          : String(result).toLowerCase();
    } catch (error) {
      // If submit throws, check mempool for the expected transaction. A mempool
      // hit proves the transaction reached the network, so promote to SUBMITTED.
      try {
        const key = BLOCKFROST_KEY() as string;
        const bf = key.startsWith('http')
          ? new BlockFrostAPI({ projectId: 'devnet', customBackend: key })
          : new BlockFrostAPI({ projectId: key });
        await bf.mempoolTx(expected);
        await this.checkDb.markSubmitted(id, expected, storedSignedTx);
        this.logger.log(
          `Mempool recovery promoted ${id} to SUBMITTED: ${expected}`,
        );
        return;
      } catch {
        throw error;
      }
    }
    if (returned !== expected) {
      throw new Error(
        `submitTx returned mismatched hash ${returned} expected ${expected}`,
      );
    }
    // Write SUBMITTED immediately before any deployment or transaction-table bookkeeping.
    await this.checkDb.markSubmitted(id, expected, storedSignedTx);
    this.logger.log(`Submitted ${id}: ${expected}`);
  }

  private async recordFailure(
    id: string,
    operation: string,
    error: unknown,
  ): Promise<void> {
    const message = `${operation} error: ${this.storedErrorMessage(error)}`;
    const check = await this.checkDb.findOne(id);
    if (!check.txid) {
      if (this.isTransientBuildError(error)) {
        await this.checkDb.update(id, { error: message });
        this.logger.warn(
          `Transient build failure for ${id}, returning to the queue: ${message}`,
        );
        throw error;
      }
      await this.checkDb.update(id, {
        status: CheckStatus.ERROR,
        error: message,
      });
      return;
    }
    const reason = `AMBIGUOUS submit for ${operation}: ${message} (tx ${check.txid} may have reached the network, reconcile by hash)`;
    await this.checkDb.update(id, {
      status: CheckStatus.QUEUED,
      error: reason,
    });
    this.logger.warn(
      `Ambiguous submit for ${id} with txid ${check.txid}: ${message}`,
    );
    throw error;
  }

  async markRetriesExhausted(id: string, error: unknown): Promise<void> {
    const message = this.storedErrorMessage(error);
    const check = await this.checkDb.findOne(id).catch(() => null);
    if (
      !check ||
      check.status === CheckStatus.SUBMITTED ||
      check.status === CheckStatus.CONFIRMED ||
      check.status === CheckStatus.SUCCESS
    ) {
      return;
    }

    if (check.txid && check.signedTx) {
      // Prefer direct Blockfrost tx lookup for finality, but on exhaustion we
      // only promote to SUBMITTED, never to SUCCESS/CONFIRMED. The reconciler
      // will later prove depth and provenance.
      try {
        const key = BLOCKFROST_KEY() as string;
        const bf = key.startsWith('http')
          ? new BlockFrostAPI({ projectId: 'devnet', customBackend: key })
          : new BlockFrostAPI({ projectId: key });
        // Try mempool first, then chain via txs; any hit becomes SUBMITTED.
        try {
          await bf.mempoolTx(check.txid);
          await this.checkDb.markSubmitted(id, check.txid, check.signedTx);
          this.logger.warn(
            `Reconciled ${id} by mempool after retries exhausted: ${check.txid} promoted to SUBMITTED`,
          );
          return;
        } catch {
          // not in mempool, try chain
        }
        // Use BlockFrostAPI txs via direct client if available; fallback to provider fetchTxInfo
        try {
          await bf.txs(check.txid);
          await this.checkDb.markSubmitted(id, check.txid, check.signedTx);
          this.logger.warn(
            `Reconciled ${id} by hash after retries exhausted: ${check.txid} is on chain, promoted to SUBMITTED`,
          );
          return;
        } catch {
          await this.provider.fetchTxInfo(check.txid);
          await this.checkDb.markSubmitted(id, check.txid, check.signedTx);
          this.logger.warn(
            `Reconciled ${id} by hash after retries exhausted: ${check.txid} is on chain`,
          );
          return;
        }
      } catch (fetchError) {
        if (!this.isNotFound(fetchError)) {
          const reason = `AMBIGUOUS after retries exhausted: ${message} (tx ${check.txid} could not be confirmed, reconcile by hash)`;
          await this.checkDb.update(id, {
            status: CheckStatus.QUEUED,
            error: reason,
          });
          this.logger.warn(
            `Retries exhausted for ${id} with unresolved txid ${check.txid}: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`,
          );
          return;
        }
        // 404 on chain: keep as QUEUED for reconciler to observe mempool, or leave for later sweep
        try {
          const key = BLOCKFROST_KEY() as string;
          const bf = key.startsWith('http')
            ? new BlockFrostAPI({ projectId: 'devnet', customBackend: key })
            : new BlockFrostAPI({ projectId: key });
          await bf.mempoolTx(check.txid);
          await this.checkDb.markSubmitted(id, check.txid, check.signedTx);
          this.logger.warn(
            `Retries exhausted for ${id} with tx ${check.txid} in mempool`,
          );
          return;
        } catch (mempoolError) {
          if (!this.isNotFound(mempoolError)) {
            const reason = `AMBIGUOUS after retries exhausted: ${message} (tx ${check.txid} mempool lookup failed, reconcile by hash)`;
            await this.checkDb.update(id, {
              status: CheckStatus.QUEUED,
              error: reason,
            });
            this.logger.warn(
              `Retries exhausted for ${id} with mempool lookup failure for ${check.txid}`,
            );
            return;
          }
          const reason = `AMBIGUOUS after retries exhausted: ${message} (tx ${check.txid} was absent from chain and mempool, reconcile by hash)`;
          await this.checkDb.update(id, {
            status: CheckStatus.QUEUED,
            error: reason,
          });
          this.logger.warn(
            `Retries exhausted for ${id} with unresolved txid ${check.txid}`,
          );
          return;
        }
      }
    }

    if (error instanceof NoConfirmedFundingUtxoError) {
      const reason = `No confirmed funding UTxO: ${error.confirmedCount} confirmed, ${error.unconfirmedCount} unconfirmed`;
      await this.checkDb.update(id, {
        status: CheckStatus.ERROR,
        error: reason,
      });
      this.logger.warn(`Retries exhausted for ${id}: ${reason}`);
      return;
    }

    await this.checkDb.update(id, {
      status: CheckStatus.ERROR,
      error: `retries exhausted: ${message}`,
    });
    this.logger.error(`Retries exhausted for ${id}: ${message}`);
  }

  private async saveDeployment(deployment: StoredDeployment): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.deploymentService.saveDeployment({
          contractAddress: deployment.contractAddress,
          deploymentTxHash: deployment.txid,
          deploymentOutputIndex: deployment.outputIndex,
          deployAddress: deployment.deployAddress,
          scriptHash: this.objectEventScriptHash,
        });
        return;
      } catch (error) {
        if (attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  private async findOnChainDeployment(): Promise<{
    txHash: string;
    outputIndex: number;
  } | null> {
    const utxos = await this.provider.fetchAddressUTxOs(this.deployerAddress);
    const match = utxos.find(
      (utxo) => utxo.output.scriptHash === this.objectEventScriptHash,
    );
    return match
      ? {
          txHash: match.input.txHash,
          outputIndex: match.input.outputIndex,
        }
      : null;
  }

  private async getMintContext(
    signedTx: string,
    providedUtxos?: UTxO[],
  ): Promise<{
    contractAddress: string;
    utxoRef: { txHash: string; outputIndex: number };
  }> {
    const parser = new TxParser(
      new CSLSerializer(),
      this.factory.fetcher as unknown as ConstructorParameters<
        typeof TxParser
      >[1],
    );
    const body = await parser.parse(signedTx, providedUtxos);
    const output = body.outputs.find((candidate) =>
      candidate.amount.some((asset) => asset.unit !== 'lovelace'),
    );
    const input = body.inputs[0]?.txIn;
    if (!output || !input) {
      throw new Error(
        'Stored mint transaction is missing its mint output or input',
      );
    }
    return {
      contractAddress: output.address,
      utxoRef: {
        txHash: input.txHash,
        outputIndex: input.txIndex,
      },
    };
  }

  private async ensureDeployment(
    data: tokenizeCommodityJob,
    mintTxid: string,
    signedTx: string,
    storedDeployment?: StoredDeployment,
    inputUtxos?: UTxO[],
  ): Promise<void> {
    const context = await this.getMintContext(signedTx, inputUtxos);
    if (
      await this.deploymentService.deploymentExistsByContractAddress(
        context.contractAddress,
      )
    ) {
      return;
    }

    const onChain = await this.findOnChainDeployment();
    if (onChain) {
      await this.saveDeployment({
        signedTx: storedDeployment?.signedTx ?? '',
        txid: onChain.txHash,
        outputIndex: onChain.outputIndex,
        contractAddress: context.contractAddress,
        deployAddress: this.deployerAddress,
      });
      return;
    }

    let deployment = storedDeployment;
    if (!deployment) {
      const result = (await this.retryBuildTransaction(() =>
        buildDeployRef(
          this.factory,
          {
            data: {
              ...data,
              deployAddress: this.deployerAddress,
              utxoRef: context.utxoRef,
            },
          },
          true,
        ),
      )) as
        | {
            deploymentTxHash: string;
            signedTx: string;
            deploymentOutputIndex: number;
          }
        | undefined;
      if (!result) throw new Error('buildDeployRef returned empty');
      deployment = {
        signedTx: result.signedTx,
        txid: result.deploymentTxHash,
        outputIndex: result.deploymentOutputIndex,
        contractAddress: context.contractAddress,
        deployAddress: this.deployerAddress,
      };
      await this.checkDb.attachReferenceDeployment(
        data.id,
        mintTxid,
        signedTx,
        this.encodeStoredTx(signedTx, deployment),
      );
    }

    await this.factory.submitTx(deployment.signedTx);
    await this.saveDeployment(deployment);
  }

  async tokenizeCommodity(data: tokenizeCommodityJob): Promise<void> {
    try {
      const existing = await this.handleExistingTx(data.id);
      if (existing.kind === 'reconciliation') return;

      let txid: string;
      let signedTx: string;
      let storedSignedTx: string | undefined;
      let storedDeployment: StoredDeployment | undefined;
      let mintInputUtxos: UTxO[] | undefined;
      if (existing.kind === 'existing') {
        ({
          txid,
          signedTx,
          storedSignedTx,
          deployment: storedDeployment,
        } = existing);
        const check = await this.checkDb.findOne(data.id);
        if (
          check.status === CheckStatus.SUBMITTED ||
          check.status === CheckStatus.CONFIRMED ||
          check.status === CheckStatus.SUCCESS
        ) {
          try {
            await this.ensureDeployment(
              data,
              txid,
              signedTx,
              storedDeployment,
              mintInputUtxos,
            );
          } catch (deployError) {
            if (this.isTransientBuildError(deployError)) {
              throw deployError;
            }
            this.logger.error(
              `deployment bookkeeping failed after mint ${txid}: ${deployError}`,
            );
          }
          return;
        }
        await this.submitWithHashCheck(data.id, signedTx, txid, storedSignedTx);
      } else {
        const result = (await this.retryBuildTransaction(() =>
          buildMint(this.factory, { data }, true),
        )) as
          | {
              mintTxHash: string;
              signedTx: string;
              singleton: string;
              inputUtxos: UTxO[];
            }
          | undefined;
        if (!result) throw new Error('buildMint returned empty');
        txid = result.mintTxHash;
        signedTx = result.signedTx;
        mintInputUtxos = result.inputUtxos;
        await this.checkDb.update(data.id, { txid, signedTx });
        await this.submitWithHashCheck(data.id, signedTx, txid);
        this.logger.log(
          `Mint submitted with singleton: ${result.singleton} at txid: ${txid}`,
        );
      }

      // SUBMITTED already written before bookkeeping
      try {
        await this.ensureDeployment(
          data,
          txid,
          signedTx,
          storedDeployment,
          mintInputUtxos,
        );
      } catch (deployError) {
        if (this.isTransientBuildError(deployError)) {
          throw deployError;
        }
        this.logger.error(
          `deployment bookkeeping failed after mint ${txid}: ${deployError}`,
        );
      }
      try {
        await this.db.create({ txid });
      } catch (dbError) {
        this.logger.error(`bookkeeping create failed for ${txid}: ${dbError}`);
      }
    } catch (error) {
      this.logger.error(`Error minting: ${error}`);
      await this.recordFailure(data.id, 'minting', error);
    }
  }

  async recreateCommodity(data: recreateCommodityJob): Promise<void> {
    try {
      const existing = await this.handleExistingTx(data.id);
      if (existing.kind === 'reconciliation') return;

      let hash: string;
      let signedTx: string;
      let orderedOutRefs: { txHash: string; outputIndex: number }[];
      if (existing.kind === 'existing') {
        hash = existing.txid;
        signedTx = existing.signedTx;
        const check = await this.checkDb.findOne(data.id);
        if (
          check.status === CheckStatus.SUBMITTED ||
          check.status === CheckStatus.CONFIRMED ||
          check.status === CheckStatus.SUCCESS
        ) {
          return;
        }
        await this.submitWithHashCheck(
          data.id,
          signedTx,
          hash,
          existing.storedSignedTx,
        );
        const utxos = await this.factory.getUtxosByOutRef(data.utxos);
        orderedOutRefs = utxos.map((utxo) => utxo.input);
      } else {
        if (!data.utxoRef || Object.keys(data.utxoRef).length === 0) {
          data.utxoRef = await this.enrichUtxoRef(data.utxos);
        }
        const result = (await this.retryBuildTransaction(() =>
          buildRecreate(this.factory, { data }, true),
        )) as
          | {
              hash: string;
              signedTx: string;
              orderedOutRefs: { txHash: string; outputIndex: number }[];
            }
          | undefined;
        if (!result) throw new Error('buildRecreate returned empty');
        ({ hash, orderedOutRefs } = result);
        signedTx = result.signedTx;
        await this.checkDb.update(data.id, {
          txid: hash,
          signedTx,
        });
        await this.submitWithHashCheck(data.id, signedTx, hash);
      }

      this.logger.log(`Recreation submitted: ${hash}`);
      try {
        for (const [index, utxo] of orderedOutRefs.entries()) {
          await this.db.recreate(utxo.txHash, utxo.outputIndex, {
            recreated: { txHash: hash, outputIndex: index },
          });
        }
      } catch (dbError) {
        this.logger.error(`recreate bookkeeping failed: ${dbError}`);
      }
    } catch (error) {
      this.logger.error(`Error recreating: ${error}`);
      await this.recordFailure(data.id, 'recreating', error);
    }
  }

  async spendCommodity(data: spendCommodityJob): Promise<void> {
    try {
      const existing = await this.handleExistingTx(data.id);
      if (existing.kind === 'reconciliation') return;

      let hash: string;
      let signedTx: string;
      if (existing.kind === 'existing') {
        hash = existing.txid;
        signedTx = existing.signedTx;
        const check = await this.checkDb.findOne(data.id);
        if (
          check.status === CheckStatus.SUBMITTED ||
          check.status === CheckStatus.CONFIRMED ||
          check.status === CheckStatus.SUCCESS
        ) {
          return;
        }
        await this.submitWithHashCheck(
          data.id,
          signedTx,
          hash,
          existing.storedSignedTx,
        );
      } else {
        if (!data.utxoRef || Object.keys(data.utxoRef).length === 0) {
          data.utxoRef = await this.enrichUtxoRef(data.utxos);
        }
        const result = (await this.retryBuildTransaction(() =>
          buildSpend(this.factory, { data }, true),
        )) as { hash: string; signedTx: string } | undefined;
        if (!result) throw new Error('buildSpend returned empty');
        hash = result.hash;
        signedTx = result.signedTx;
        await this.checkDb.update(data.id, {
          txid: hash,
          signedTx,
        });
        await this.submitWithHashCheck(data.id, signedTx, hash);
      }

      this.logger.log(`Spend submitted: ${hash}`);
      try {
        for (const utxo of data.utxos) {
          await this.db.spent(utxo.txHash, utxo.outputIndex, {
            spent: hash,
          });
        }
      } catch (dbError) {
        this.logger.error(`spend bookkeeping failed: ${dbError}`);
      }
    } catch (error) {
      this.logger.error(`Error spending: ${error}`);
      await this.recordFailure(data.id, 'spending', error);
    }
  }
}
