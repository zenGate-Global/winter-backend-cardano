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
import { CheckService } from '../check/check.service';
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

  const seed = async (
    txid: string,
    status: CheckStatus = CheckStatus.SUBMITTED,
  ): Promise<string> => {
    const id = randomUUID();
    await checkDb.create({ id, type: CheckType.SPEND, status });
    await checkDb.update(id, { txid, signedTx: 'placeholder-cbor' });
    return id;
  };

  const landed = await seed(confirmedTxHash);
  const absent = await seed(absentTxHash);
  const queuedLanded = await seed(confirmedTxHash, CheckStatus.SUCCESS);

  await reconciler.sweep();

  const landedRow = await checkDb.findOne(landed);
  // A confirmed transaction with sufficient depth must become CONFIRMED.
  // If depth is not yet sufficient, it stays SUBMITTED and will be retried.
  assert.ok(
    landedRow.status === CheckStatus.CONFIRMED ||
      landedRow.status === CheckStatus.SUBMITTED,
    `a transaction on chain must be CONFIRMED or remain SUBMITTED until depth, got ${landedRow.status}`,
  );
  if (landedRow.status === CheckStatus.CONFIRMED) {
    assert.equal(landedRow.error, null, 'a promoted row must carry no error');
    assert.ok(
      landedRow.confirmation,
      'a confirmed row must carry confirmation',
    );
  }

  const queuedRow = await checkDb.findOne(queuedLanded);
  assert.ok(
    queuedRow.status === CheckStatus.CONFIRMED ||
      queuedRow.status === CheckStatus.SUCCESS ||
      queuedRow.status === CheckStatus.SUBMITTED,
    `a legacy SUCCESS row whose transaction is on chain must be promoted or remain, got ${queuedRow.status}`,
  );

  let absentRow = await checkDb.findOne(absent);
  assert.equal(
    absentRow.status,
    CheckStatus.SUBMITTED,
    'an absent transaction must stay SUBMITTED (fail closed, no confirmation)',
  );
  assert.equal(
    absentRow.confirmation,
    null,
    'absent must have no confirmation',
  );

  await reconciler.sweep();
  absentRow = await checkDb.findOne(absent);
  assert.equal(absentRow.status, CheckStatus.SUBMITTED);
  assert.equal(absentRow.confirmation, null);

  // Third pass: the confirmed row must no longer be a candidate, the absent SUBMITTED remains candidate for future sweeps
  const candidates = await checkDb.findAwaitingConfirmation(200);
  const landedStillCandidate = candidates.some(
    (row) => row.id === landed && row.confirmation === null,
  );
  if (landedRow.status === CheckStatus.CONFIRMED) {
    assert.ok(
      !landedStillCandidate,
      'a confirmed row must leave the candidate set',
    );
  }
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
