import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockfrostProvider } from '@meshsdk/core';

import { BLOCKFROST_KEY } from '../constants';
import {
  CHAIN_CHECKED,
  CHAIN_RECHECK,
  CheckService,
} from '../check/check.service';
import { CheckStatus } from '../check/entities/check.entity';

// Settles rows that claim to have failed while holding a transaction hash.
//
// The consumer writes the hash before it submits, so an ambiguous submit can
// leave a row saying ERROR for a transaction that reached the chain. The
// consumer already looks the hash up when its retries run out, but that lookup
// can itself fail while the provider is unreachable, and then nothing revisits
// the row. Recording ERROR for a transaction that landed is the worst outcome
// available, because a caller must use a new idempotency key to retry and that
// mints a second token for a commodity that already exists.
//
// Promoting a row to SUCCESS is idempotent, so two instances sweeping at once is
// harmless. It only spends the same lookups twice.
//
// The worker runs in process, so this sweep only runs while an instance is
// alive. With `--min-instances` at 0 a scaled to zero service reconciles
// nothing until a request wakes it.
@Injectable()
export class PalmyraReconcilerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PalmyraReconcilerService.name);
  private readonly provider = new BlockfrostProvider(BLOCKFROST_KEY());
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly checkDb: CheckService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const seconds = this.intervalSeconds();
    if (seconds <= 0) {
      this.logger.log('reconciler disabled by RECONCILE_INTERVAL_SECONDS=0');
      return;
    }
    this.timer = setInterval(() => {
      void this.sweep();
    }, seconds * 1000);
    // Do not hold the process open on shutdown.
    this.timer.unref();
    this.logger.log(`reconciler sweeping every ${seconds}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  // Public so an operator can force a pass, and so the check script can drive
  // one without waiting for the interval.
  async sweep(): Promise<{ examined: number; promoted: number }> {
    if (this.running) {
      return { examined: 0, promoted: 0 };
    }
    this.running = true;
    let examined = 0;
    let promoted = 0;
    try {
      const candidates = await this.checkDb.findErrorsHoldingTxid(
        this.batchSize(),
      );
      for (const row of candidates) {
        examined += 1;
        if (await this.settle(row.id, row.txid, row.error)) {
          promoted += 1;
        }
      }
      if (examined > 0) {
        this.logger.log(
          `reconciler examined ${examined} row(s), promoted ${promoted} to SUCCESS`,
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

  // Returns true when the row was promoted to SUCCESS.
  private async settle(
    id: string,
    txid: string,
    error: string | null,
  ): Promise<boolean> {
    try {
      await this.provider.fetchTxInfo(txid);
    } catch {
      // Absent from the chain, or the provider is unreachable. Both leave the
      // row as ERROR. Advance the marker so a genuine failure stops being
      // looked up, and so a provider outage costs at most one wasted pass.
      const seen = (error ?? '').includes(CHAIN_RECHECK);
      const base = (error ?? '').replace(CHAIN_RECHECK, '').trimEnd();
      await this.checkDb.update(id, {
        error: `${base} ${seen ? CHAIN_CHECKED : CHAIN_RECHECK}`.trim(),
      });
      return false;
    }

    await this.checkDb.update(id, {
      status: CheckStatus.SUCCESS,
      txid,
      error: null,
    });
    this.logger.warn(
      `reconciled ${id}: ${txid} is on chain, the row said ERROR`,
    );
    return true;
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
