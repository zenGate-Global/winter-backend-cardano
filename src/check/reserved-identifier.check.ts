import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import {
  ChainConfirmation,
  Check,
  CheckStatus,
  CheckType,
} from './entities/check.entity.js';
import { CheckService } from './check.service.js';

// `check` is a reserved SQL keyword. A TypeORM UPDATE builder emits no table
// alias, so an alias-qualified guard such as `check.txid` reaches Postgres as
// bare `check.txid` and the statement dies with
// `syntax error at or near "check"`. Every guarded write then fails after the
// transaction already reached the chain, and the reconciler cannot promote the
// row either, so a landed mint stays QUEUED for ever.
//
// This check executes each guarded write against a real Postgres. It needs a
// live database: DATABASE_URL must point at one that this script may create a
// `check` table in.
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  assert.ok(url, 'DATABASE_URL is required');

  const dataSource = new DataSource({
    type: 'postgres',
    url,
    entities: [Check],
    synchronize: true,
    logging: false,
  });
  await dataSource.initialize();

  const service = new CheckService(dataSource.getRepository(Check));
  const txid = 'a'.repeat(64);
  const other = 'b'.repeat(64);
  const signedTx = '84a400d9';
  const composite = '84a400d9ff';

  try {
    // A submitted-but-unresolved row, exactly what an ambiguous submit leaves.
    const id = 'reserved-identifier-check';
    await dataSource.getRepository(Check).delete({ id });
    await service.create({
      id,
      type: CheckType.TOKENIZE,
      status: CheckStatus.QUEUED,
      txid,
      signedTx,
    } as unknown as Parameters<CheckService['create']>[0]);

    // Each of these runs an UPDATE with guards on the reserved table name.
    await service.markChainAttempt(id);

    const observed = await service.markObservedSubmitted(id, txid);
    assert.equal(
      observed,
      true,
      'markObservedSubmitted must move a QUEUED row',
    );

    const wrongHash = await service.markObservedSubmitted(id, other);
    assert.equal(
      wrongHash,
      false,
      'markObservedSubmitted must refuse another hash',
    );

    await service.markSubmitted(id, txid, signedTx);
    assert.equal(
      (await service.findOne(id)).status,
      CheckStatus.SUBMITTED,
      'markSubmitted must keep the row SUBMITTED',
    );

    await service.attachReferenceDeployment(id, txid, signedTx, composite);
    assert.equal(
      (await service.findOne(id)).signedTx,
      composite,
      'attachReferenceDeployment must replace the stored CBOR',
    );

    const failed = await service.markFailedContract(id, txid, 'script failed');
    assert.equal(failed, true, 'markFailedContract must mark a matching row');

    const confirmation = {
      network: 'preview',
      txid,
      blockHash: 'c'.repeat(64),
      blockHeight: 100,
      slot: 999,
      depth: 15,
      requiredDepth: 15,
      confirmedAt: new Date().toISOString(),
      provenance: null,
    } as unknown as ChainConfirmation;

    const confirmed = await service.markConfirmed(id, txid, confirmation);
    assert.equal(confirmed, true, 'markConfirmed must promote the row');
    assert.equal(
      (await service.findOne(id)).status,
      CheckStatus.CONFIRMED,
      'a promoted row must read CONFIRMED',
    );

    const again = await service.markConfirmed(id, txid, confirmation);
    assert.equal(again, false, 'a confirmed row must not be confirmed twice');

    // The reconciler sweep reads through the same reserved table name.
    await service.findUnsettledHoldingTxid(10);
    await service.findAwaitingConfirmation(10);

    await dataSource.getRepository(Check).delete({ id });
    console.log('reserved-identifier check passed');
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
