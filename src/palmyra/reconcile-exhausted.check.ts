// Proves that a job whose retries run out is settled against the chain rather
// than assumed to have failed.
//
// Two branches matter, and they must go opposite ways:
//   a transaction that IS on chain must settle SUCCESS, because recording ERROR
//   would make a caller retry with a new idempotency key and mint a second
//   token for a commodity that already exists;
//   a transaction that is absent must settle ERROR.
//
// Run against a live database and a live Blockfrost key:
//   pnpm run check:reconcile-exhausted <confirmedTxHash>
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CheckService } from '../check/check.service';
import { CheckStatus, CheckType } from '../check/entities/check.entity';
import { PalmyraConsumerService } from './palmyra.consumer.service';

const confirmedTxHash = process.argv[2];
assert.ok(
  confirmedTxHash && /^[0-9a-f]{64}$/.test(confirmedTxHash),
  'pass a confirmed 64 character transaction hash as the first argument',
);
// A well formed hash that no transaction will ever have.
const absentTxHash = 'f'.repeat(64);

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const checkDb = app.get(CheckService);
  const consumer = app.get(PalmyraConsumerService);
  const seed = async (txid: string): Promise<string> => {
    const id = randomUUID();
    await checkDb.create({
      id,
      type: CheckType.TOKENIZE,
      status: CheckStatus.QUEUED,
    });
    // `txid` and `signedTx` are only writable through update, which is also how
    // the consumer records them before it submits.
    await checkDb.update(id, { txid, signedTx: 'placeholder-cbor' });
    return id;
  };

  const landed = await seed(confirmedTxHash);
  await consumer.markRetriesExhausted(landed, new Error('simulated outage'));
  const landedRow = await checkDb.findOne(landed);
  assert.equal(
    landedRow.status,
    CheckStatus.SUBMITTED,
    `a transaction on chain must settle SUBMITTED, got ${landedRow.status}`,
  );
  assert.equal(landedRow.txid, confirmedTxHash);
  assert.equal(landedRow.error, null, 'a reconciled row must carry no error');

  const absent = await seed(absentTxHash);
  await consumer.markRetriesExhausted(absent, new Error('simulated outage'));
  const absentRow = await checkDb.findOne(absent);
  assert.equal(
    absentRow.status,
    CheckStatus.ERROR,
    `a transaction absent from chain must settle ERROR, got ${absentRow.status}`,
  );
  assert.match(absentRow.error ?? '', /retries exhausted/);

  // A row that already succeeded must never be touched.
  const done = randomUUID();
  await checkDb.create({
    id: done,
    type: CheckType.TOKENIZE,
    status: CheckStatus.SUCCESS,
  });
  await checkDb.update(done, { txid: confirmedTxHash });
  await consumer.markRetriesExhausted(done, new Error('simulated outage'));
  assert.equal((await checkDb.findOne(done)).status, CheckStatus.SUCCESS);

  await app.close();
  console.log('reconcile-exhausted check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
