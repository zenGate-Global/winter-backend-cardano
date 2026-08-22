// Proves the reconciliation sweep.
//
//   a row saying ERROR whose transaction IS on chain must become SUCCESS;
//   a row whose transaction is absent must stay ERROR;
//   an absent row must stop being looked up after two passes, because `check`
//   has no timestamp column and a genuine failure would otherwise be re-checked
//   against the chain for ever.
//
// Run against a live database and a live Blockfrost key:
//   pnpm run check:reconciler <confirmedTxHash>
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import {
  CHAIN_CHECKED,
  CHAIN_RECHECK,
  CheckService,
} from '../check/check.service';
import { CheckStatus, CheckType } from '../check/entities/check.entity';
import { PalmyraReconcilerService } from './palmyra.reconciler.service';

const confirmedTxHash = process.argv[2];
assert.ok(
  confirmedTxHash && /^[0-9a-f]{64}$/.test(confirmedTxHash),
  'pass a confirmed 64 character transaction hash as the first argument',
);
const absentTxHash = 'e'.repeat(64);

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const checkDb = app.get(CheckService);
  const reconciler = app.get(PalmyraReconcilerService);

  const seed = async (txid: string): Promise<string> => {
    const id = randomUUID();
    await checkDb.create({
      id,
      type: CheckType.TOKENIZE,
      status: CheckStatus.ERROR,
    });
    await checkDb.update(id, { txid, error: 'simulated ambiguous submit' });
    return id;
  };

  const landed = await seed(confirmedTxHash);
  const absent = await seed(absentTxHash);

  await reconciler.sweep();

  const landedRow = await checkDb.findOne(landed);
  assert.equal(
    landedRow.status,
    CheckStatus.SUCCESS,
    `a transaction on chain must be promoted, got ${landedRow.status}`,
  );
  assert.equal(landedRow.error, null, 'a promoted row must carry no error');

  let absentRow = await checkDb.findOne(absent);
  assert.equal(
    absentRow.status,
    CheckStatus.ERROR,
    'an absent transaction must stay ERROR',
  );
  assert.ok(
    (absentRow.error ?? '').includes(CHAIN_RECHECK),
    `first pass must mark the row for one more look, got ${absentRow.error}`,
  );

  await reconciler.sweep();
  absentRow = await checkDb.findOne(absent);
  assert.equal(absentRow.status, CheckStatus.ERROR);
  assert.ok(
    (absentRow.error ?? '').includes(CHAIN_CHECKED),
    `second pass must settle the row, got ${absentRow.error}`,
  );
  assert.ok(
    !(absentRow.error ?? '').includes(CHAIN_RECHECK),
    'the intermediate marker must be replaced, not stacked',
  );
  assert.ok(
    (absentRow.error ?? '').includes('simulated ambiguous submit'),
    'the original failure text must survive',
  );

  // Third pass: the settled row must no longer be a candidate at all.
  const candidates = await checkDb.findErrorsHoldingTxid(200);
  assert.ok(
    !candidates.some((row) => row.id === absent),
    'a settled row must leave the candidate set',
  );

  await checkDb.update(landed, { error: 'test row' });
  console.log(
    `reconciler check passed (promoted ${landed.slice(0, 8)}, settled ${absent.slice(0, 8)})`,
  );
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
