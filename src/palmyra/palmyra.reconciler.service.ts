import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BlockFrostAPI,
  BlockfrostServerError,
} from '@blockfrost/blockfrost-js';

import { BLOCKFROST_KEY } from '../constants';
import { CheckService } from '../check/check.service';
import {
  CheckStatus,
  CheckType,
  TokenizeProvenance,
} from '../check/entities/check.entity';
import {
  buildConfirmation,
  depthFromHeights,
  getCachedGenesis,
  isSafeNonNegativeInt,
  networkLabel,
  parseRequiredDepth,
  proveTokenizeProvenance,
  validateBlockResponse,
  validateTxResponse,
} from './chain-confirmation';

@Injectable()
export class PalmyraReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PalmyraReconcilerService.name);
  private readonly bf: BlockFrostAPI;
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly checkDb: CheckService,
    private readonly configService: ConfigService,
  ) {
    const key = BLOCKFROST_KEY() as string;
    this.bf = key.startsWith('http')
      ? new BlockFrostAPI({ projectId: 'devnet', customBackend: key })
      : new BlockFrostAPI({ projectId: key });
  }

  onModuleInit(): void {
    const seconds = this.intervalSeconds();
    if (seconds <= 0) {
      this.logger.log('reconciler disabled by RECONCILE_INTERVAL_SECONDS=0');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep();
    }, seconds * 1000);
    this.timer.unref();
    this.logger.log(`reconciler sweeping every ${seconds}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async sweep(): Promise<{ examined: number; promoted: number }> {
    if (this.running) {
      return { examined: 0, promoted: 0 };
    }
    this.running = true;
    let examined = 0;
    let promoted = 0;
    try {
      const latest = await this.fetchLatest();
      if (!latest) {
        this.logger.warn('reconciler: latest block unavailable, skip sweep');
        return { examined, promoted };
      }
      const genesis = await getCachedGenesis(this.bf);
      const requiredDepth = parseRequiredDepth(
        this.configService.get<string>('CHAIN_CONFIRMATION_DEPTH'),
        genesis.securityParam,
      );
      if (requiredDepth === null) {
        this.logger.warn('reconciler: depth policy unavailable, fail closed');
        return { examined, promoted };
      }
      const candidates = await this.checkDb.findAwaitingConfirmation(
        this.batchSize(),
      );
      for (const row of candidates) {
        examined += 1;
        let ok = false;
        try {
          ok = await this.tryConfirm(row, latest.height, requiredDepth);
        } finally {
          try {
            await this.checkDb.markChainAttempt(row.id);
          } catch {
            void 0;
          }
        }
        if (ok) promoted += 1;
      }
      if (examined > 0) {
        this.logger.log(
          `reconciler examined ${examined} row(s), confirmed ${promoted}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `reconciler sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
    return { examined, promoted };
  }

  private async fetchLatest(): Promise<{ height: number } | null> {
    try {
      const block = await (
        this.bf as unknown as {
          blocksLatest: () => Promise<Record<string, unknown>>;
        }
      ).blocksLatest();
      const height = block.height as unknown;
      if (!isSafeNonNegativeInt(height)) return null;
      return { height: height as number };
    } catch {
      return null;
    }
  }

  private isNotFound(error: unknown): boolean {
    if (error instanceof BlockfrostServerError) {
      return error.status_code === 404;
    }
    const candidate = error as { status_code?: unknown; statusCode?: unknown };
    if (candidate && typeof candidate === 'object') {
      if (candidate.status_code === 404 || candidate.statusCode === 404)
        return true;
    }
    const msg = error instanceof Error ? error.message : String(error);
    return (
      /"status(?:_code)?"\s*:\s*404/.test(msg) ||
      /has not been found/i.test(msg)
    );
  }

  private async tryConfirm(
    row: { id: string; txid: string; type: CheckType; additionalInfo: unknown },
    latestHeight: number,
    requiredDepth: number,
  ): Promise<boolean> {
    const expectedTxid = row.txid.toLowerCase();
    let tx: unknown;
    try {
      tx = await (
        this.bf as unknown as { txs: (hash: string) => Promise<unknown> }
      ).txs(expectedTxid);
    } catch (error) {
      if (this.isNotFound(error)) return false;
      return false;
    }
    const parsed = validateTxResponse(tx, expectedTxid);
    if (!parsed) return false;
    if (parsed.valid_contract === false) {
      await this.checkDb.markFailedContract(
        row.id,
        expectedTxid,
        'chain-invalid: valid_contract false',
      );
      this.logger.warn(
        `reconciler marked ${row.id} ERROR valid_contract false`,
      );
      return false;
    }
    if (latestHeight < parsed.block_height) return false;
    const depth = depthFromHeights(latestHeight, parsed.block_height);
    if (depth < requiredDepth) {
      const status = (row as unknown as { status?: CheckStatus }).status as
        | CheckStatus
        | undefined;
      if (status === CheckStatus.QUEUED || status === CheckStatus.ERROR) {
        try {
          await this.checkDb.markObservedSubmitted(row.id, expectedTxid);
        } catch {
          void 0;
        }
      }
      return false;
    }
    let block: unknown;
    try {
      block = await (
        this.bf as unknown as { blocks: (hash: string) => Promise<unknown> }
      ).blocks(parsed.block);
    } catch {
      return false;
    }
    if (!validateBlockResponse(block, parsed)) return false;

    let tx2: unknown;
    try {
      tx2 = await (
        this.bf as unknown as { txs: (hash: string) => Promise<unknown> }
      ).txs(expectedTxid);
    } catch {
      return false;
    }
    const parsed2 = validateTxResponse(tx2, expectedTxid);
    if (!parsed2) return false;
    if (
      parsed2.block !== parsed.block ||
      parsed2.block_height !== parsed.block_height ||
      parsed2.block_time !== parsed.block_time ||
      parsed2.slot !== parsed.slot ||
      parsed2.valid_contract !== true
    )
      return false;

    let provenance: TokenizeProvenance | null = null;
    if (row.type === CheckType.TOKENIZE) {
      const info = row.additionalInfo as {
        tokenName?: string;
        metadataReference?: string;
      } | null;
      const tokenName = info?.tokenName ?? '';
      const metadataReference = info?.metadataReference ?? '';
      provenance = await proveTokenizeProvenance(
        this.bf,
        expectedTxid,
        tokenName,
        metadataReference,
      );
      if (!provenance) return false;
    }

    const confirmation = buildConfirmation({
      network: networkLabel(),
      txid: expectedTxid,
      blockHash: parsed.block,
      blockHeight: parsed.block_height,
      slot: parsed.slot,
      depth,
      requiredDepth,
      confirmedAt: new Date().toISOString(),
      provenance,
    });
    const ok = await this.checkDb.markConfirmed(
      row.id,
      expectedTxid,
      confirmation,
    );
    if (ok)
      this.logger.log(
        `reconciled ${row.id} CONFIRMED ${expectedTxid} depth ${depth}`,
      );
    return ok;
  }

  private intervalSeconds(): number {
    const raw = this.configService.get<string>('RECONCILE_INTERVAL_SECONDS');
    const parsed = Number(raw);
    return raw !== undefined && Number.isFinite(parsed) ? parsed : 300;
  }

  private batchSize(): number {
    const raw = this.configService.get<string>('RECONCILE_BATCH_SIZE');
    const parsed = Number(raw);
    return raw !== undefined && Number.isFinite(parsed) && parsed > 0
      ? parsed
      : 25;
  }
}
