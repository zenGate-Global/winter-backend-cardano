import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import {
  recreateCommodityJob,
  spendCommodityJob,
  tokenizeCommodityJob,
} from '../types/job.dto';
import {
  BlockfrostProvider,
  resolveScriptHash,
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
      deployment?: StoredDeployment;
    };

@Injectable()
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
    this.provider = new BlockfrostProvider(BLOCKFROST_KEY());
    this.deployerAddress = this.configService.get('DEPLOYER_ADDRESS') as string;
    this.factory = new EventFactory(
      NETWORK(),
      ZENGATE_MNEMONIC(),
      this.provider,
      this.provider,
      // Without an evaluator every redeemer declares the fixed default budget
      // of mem 7,000,000. Two of those already reach the preview cap of
      // 17,500,000, so a two-commodity spend or a three-commodity recreate is
      // rejected with ExUnitsTooBigUTxO. It also overpays the script fee on
      // every single transaction.
      this.provider,
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

  // Only for a failure that happened before anything was submitted, where a
  // retry is therefore free of risk.
  private isTransientBuildError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    // Blockfrost answers 404 for an input that exists but has not reached a
    // block yet, which is what a chained build hits under a burst.
    if (/"status(?:_code)?"\s*:\s*404/.test(msg)) return true;
    if (/has not been found/i.test(msg)) return true;
    // The evaluator resolves inputs through the same provider, so it fails the
    // same way on a chained build. A validator that genuinely rejects also
    // lands here, and it costs the remaining attempts before the row settles.
    if (/evaluate redeemers failed|tx evaluation fail/i.test(msg)) return true;
    // The wallet can be momentarily short while its change confirms.
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
      if (check.status === CheckStatus.SUCCESS) return;
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
        ...(check.status === CheckStatus.SUCCESS
          ? {}
          : { status: CheckStatus.ERROR }),
        error: message,
      });
      return { kind: 'reconciliation' };
    }

    const stored = this.decodeStoredTx(check.signedTx);
    if (!stored.deployment) {
      this.logger.log(`Resubmitting stored tx for ${id}: ${check.txid}`);
      try {
        await this.factory.submitTx(stored.signedTx);
      } catch (submitError) {
        try {
          await this.provider.fetchTxInfo(check.txid);
          this.logger.log(`Stored tx for ${id} is confirmed: ${check.txid}`);
        } catch {
          throw submitError;
        }
      }
    }
    return {
      kind: 'existing',
      txid: check.txid,
      signedTx: stored.signedTx,
      deployment: stored.deployment,
    };
  }

  private async recordFailure(
    id: string,
    operation: string,
    error: unknown,
  ): Promise<void> {
    const message = `${operation} error: ${
      error instanceof Error ? error.message : String(error)
    }`;
    const check = await this.checkDb.findOne(id);
    if (!check.txid) {
      // Nothing reached the network, so a retry cannot double spend or double
      // mint. A transient build failure must go back on the queue. A burst
      // that chains onto an unconfirmed change output gets a Blockfrost 404
      // until that output reaches a block, and the retry then succeeds.
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
    // A submit error alone cannot prove that the stored transaction was
    // rejected. A duplicate or BadInputs response can mean that the identical
    // transaction is pending or confirmed.
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

  // Called by the queue worker on the last attempt of a job that keeps
  // throwing. A stored hash remains non-terminal unless the chain proves
  // success. A lookup failure leaves the row for the reconciler.
  async markRetriesExhausted(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const check = await this.checkDb.findOne(id).catch(() => null);
    if (!check || check.status === CheckStatus.SUCCESS) {
      return;
    }

    if (check.txid) {
      try {
        await this.provider.fetchTxInfo(check.txid);
        await this.checkDb.update(id, {
          status: CheckStatus.SUCCESS,
          txid: check.txid,
          error: null,
        });
        this.logger.warn(
          `Reconciled ${id} by hash after retries were exhausted: ${check.txid} is on chain`,
        );
        return;
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
        // fetchTxInfo 404: the tx is not confirmed. If it is in the mempool
        // it can still confirm, so leave it for the reconciler.
        try {
          const key = BLOCKFROST_KEY() as string;
          const bf = key.startsWith('http')
            ? new BlockFrostAPI({ projectId: 'devnet', customBackend: key })
            : new BlockFrostAPI({ projectId: key });
          await bf.mempoolTx(check.txid);
          const reason = `AMBIGUOUS after retries exhausted: ${message} (tx ${check.txid} is in mempool, reconcile by hash)`;
          await this.checkDb.update(id, {
            status: CheckStatus.QUEUED,
            error: reason,
          });
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
        }
      }
    }

    const suffix = check.txid
      ? ` (tx ${check.txid} was not found on chain at settlement, re-check by hash before retrying)`
      : '';
    await this.checkDb.update(id, {
      status: CheckStatus.ERROR,
      error: `retries exhausted: ${message}${suffix}`,
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
    const scriptHash = resolveScriptHash(
      this.factory.objectEventContract.code,
      this.factory.objectEventContract.version,
    );
    const utxos = await this.provider.fetchAddressUTxOs(this.deployerAddress);
    const match = utxos.find((utxo) => utxo.output.scriptHash === scriptHash);
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
    // Without these the parser re-resolves every outref through Blockfrost,
    // which only knows confirmed transactions, so a mint that chained onto an
    // unconfirmed change output fails here after it already submitted.
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
      await this.checkDb.update(data.id, {
        txid: mintTxid,
        signedTx: this.encodeStoredTx(signedTx, deployment),
      });
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
      let storedDeployment: StoredDeployment | undefined;
      // Kept so the deployment step can parse the mint without asking
      // Blockfrost to resolve outrefs that are not in a block yet.
      let mintInputUtxos: UTxO[] | undefined;
      if (existing.kind === 'existing') {
        ({ txid, signedTx, deployment: storedDeployment } = existing);
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
        await this.factory.submitTx(signedTx);
        this.logger.log(
          `Mint successful with singleton: ${result.singleton} at txid: ${txid}`,
        );
      }

      // The transaction is on the network. Record that before anything else.
      // Nothing after this point may turn a submitted mint back into a
      // failure: a caller polls this row for SUCCESS, and an ERROR here makes
      // it retry a mint that already produced a token.
      await this.checkDb.update(data.id, {
        status: CheckStatus.SUCCESS,
        txid,
        error: null,
      });
      try {
        await this.ensureDeployment(
          data,
          txid,
          signedTx,
          storedDeployment,
          mintInputUtxos,
        );
      } catch (deployError) {
        // A missing deployment row is recoverable. Recreate and spend fall
        // back to an inlined script, and the next mint calls
        // findOnChainDeployment and records the existing reference script.
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
      let orderedOutRefs: { txHash: string; outputIndex: number }[];
      if (existing.kind === 'existing') {
        hash = existing.txid;
        const utxos = await this.factory.getUtxosByOutRef(data.utxos);
        orderedOutRefs = utxos.map((utxo) => utxo.input);
      } else {
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
        await this.checkDb.update(data.id, {
          txid: hash,
          signedTx: result.signedTx,
        });
        await this.factory.submitTx(result.signedTx);
      }

      await this.checkDb.update(data.id, {
        status: CheckStatus.SUCCESS,
        txid: hash,
        error: null,
      });
      this.logger.log(`Recreation successful: ${hash}`);
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
      if (existing.kind === 'existing') {
        hash = existing.txid;
      } else {
        const result = (await this.retryBuildTransaction(() =>
          buildSpend(this.factory, { data }, true),
        )) as { hash: string; signedTx: string } | undefined;
        if (!result) throw new Error('buildSpend returned empty');
        hash = result.hash;
        await this.checkDb.update(data.id, {
          txid: hash,
          signedTx: result.signedTx,
        });
        await this.factory.submitTx(result.signedTx);
      }

      await this.checkDb.update(data.id, {
        status: CheckStatus.SUCCESS,
        txid: hash,
        // A retried job carries the error text of the attempt that failed.
        // Leaving it makes a SUCCESS row look like a failure to a caller.
        error: null,
      });
      this.logger.log(`Spend successful: ${hash}`);
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
