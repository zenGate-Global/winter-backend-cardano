import assert from 'node:assert/strict';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CheckController } from './check.controller';
import { CheckService } from './check.service';
import {
  ChainConfirmation,
  Check,
  CheckStatus,
  CheckType,
} from './entities/check.entity';
import { toPublicCheck } from './dto/public-check.dto';

const publicFields = [
  'additionalInfo',
  'confirmation',
  'error',
  'id',
  'status',
  'txid',
  'type',
];

function assertPublicFields(value: object): void {
  assert.deepEqual(Object.keys(value).sort(), publicFields);
}

const base = {
  id: 'job',
  type: CheckType.RECREATE,
  status: CheckStatus.PENDING,
  error: 'provider secret text',
  txid: null,
  confirmation: null,
  additionalInfo: {
    utxos: [
      {
        txHash: 'a'.repeat(64),
        outputIndex: 1,
        futureUtxoProperty: 'private',
      },
    ],
    newDataReferences: ['cid'],
    utxoRef: { internal: true },
    futureNested: true,
  },
  utxoRef: { internal: true },
  signedTx: 'cbor',
  requestFingerprint: 'fingerprint',
  futureTopLevel: true,
} as unknown as Check;

const pending = toPublicCheck(base);
assertPublicFields(pending);
assert.equal(pending.error, 'operation retry pending');
assert.deepEqual(pending.additionalInfo, {
  utxos: [{ txHash: 'a'.repeat(64), outputIndex: 1 }],
  newDataReferences: ['cid'],
});
assert.equal('utxoRef' in pending, false);
assert.equal('futureTopLevel' in pending, false);

const tokenize = toPublicCheck({
  ...base,
  type: CheckType.TOKENIZE,
  additionalInfo: {
    tokenName: 'Coffee',
    metadataReference: 'ipfs://metadata',
    utxoRef: { internal: true },
    futureNested: true,
  },
} as Check);
assert.deepEqual(tokenize.additionalInfo, {
  tokenName: 'Coffee',
  metadataReference: 'ipfs://metadata',
});

const spend = toPublicCheck({
  ...base,
  type: CheckType.SPEND,
  additionalInfo: {
    utxos: [{ txHash: 'b'.repeat(64), outputIndex: 0 }],
    utxoRef: { internal: true },
  },
} as unknown as Check);
assert.equal(spend.additionalInfo, null);

for (const status of [CheckStatus.PENDING, CheckStatus.QUEUED]) {
  assert.equal(
    toPublicCheck({ ...base, status } as Check).error,
    'operation retry pending',
  );
}
assert.equal(
  toPublicCheck({ ...base, status: CheckStatus.ERROR } as Check).error,
  'operation failed',
);
for (const status of [
  CheckStatus.SUBMITTED,
  CheckStatus.SUCCESS,
  CheckStatus.CONFIRMED,
]) {
  assert.equal(toPublicCheck({ ...base, status } as Check).error, null);
}
assert.equal(
  toPublicCheck({ ...base, status: CheckStatus.PENDING, error: null } as Check)
    .error,
  null,
);

const historical = toPublicCheck({
  id: 'historical',
  type: CheckType.RECREATE,
  status: CheckStatus.SUCCESS,
  additionalInfo: { newDataReferences: ['old-cid'] },
} as Check);
assertPublicFields(historical);
assert.deepEqual(historical, {
  id: 'historical',
  type: CheckType.RECREATE,
  status: CheckStatus.SUCCESS,
  error: null,
  txid: null,
  confirmation: null,
  additionalInfo: { newDataReferences: ['old-cid'] },
});

const entity = toPublicCheck(
  new Check({
    ...base,
    id: 'entity',
    status: CheckStatus.CONFIRMED,
    confirmation: {
      network: 'preview',
      txid: 'c'.repeat(64),
      blockHash: 'd'.repeat(64),
      blockHeight: 12,
      slot: 34,
      depth: 5,
      requiredDepth: 3,
      confirmedAt: '2026-09-01T00:00:00.000Z',
      provenance: null,
      futureConfirmationProperty: 'private',
    } as ChainConfirmation,
  }),
);
assertPublicFields(entity);
assert.deepEqual(entity.confirmation, {
  network: 'preview',
  txid: 'c'.repeat(64),
  blockHash: 'd'.repeat(64),
  blockHeight: 12,
  slot: 34,
  depth: 5,
  requiredDepth: 3,
  confirmedAt: '2026-09-01T00:00:00.000Z',
  provenance: null,
});

@Module({
  controllers: [CheckController],
  providers: [{ provide: CheckService, useValue: {} }],
})
class PublicCheckProofModule {}

async function assertSwaggerDocument(): Promise<void> {
  const app = await NestFactory.create(PublicCheckProofModule, {
    logger: false,
  });
  try {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    const publicSchema = document.components?.schemas?.PublicCheckDto;
    assert.ok(publicSchema && 'properties' in publicSchema);
    assert.deepEqual(
      Object.keys(publicSchema.properties ?? {}).sort(),
      publicFields,
    );

    const properties = publicSchema.properties ?? {};
    assert.deepEqual(properties.id, { type: 'string' });
    assert.deepEqual(properties.type, {
      type: 'string',
      enum: Object.values(CheckType),
      nullable: true,
    });
    assert.deepEqual(properties.status, {
      type: 'string',
      enum: Object.values(CheckStatus),
    });
    const errorSchema = properties.error;
    assert.ok(errorSchema && !('$ref' in errorSchema));
    assert.equal(errorSchema.type, 'string');
    assert.equal(errorSchema.nullable, true);
    assert.deepEqual(properties.txid, { type: 'string', nullable: true });
    const confirmationProperty = properties.confirmation;
    assert.ok(confirmationProperty && !('$ref' in confirmationProperty));
    assert.equal(confirmationProperty.nullable, true);
    assert.deepEqual(confirmationProperty.allOf, [
      { $ref: '#/components/schemas/ChainConfirmation' },
    ]);

    const confirmationSchema = document.components?.schemas?.ChainConfirmation;
    assert.ok(confirmationSchema && 'properties' in confirmationSchema);
    assert.deepEqual(Object.keys(confirmationSchema.properties ?? {}).sort(), [
      'blockHash',
      'blockHeight',
      'confirmedAt',
      'depth',
      'network',
      'provenance',
      'requiredDepth',
      'slot',
      'txid',
    ]);

    const listResponse = document.paths['/check']?.get?.responses?.['200'];
    assert.ok(listResponse && 'content' in listResponse);
    assert.deepEqual(listResponse.content?.['application/json']?.schema, {
      type: 'array',
      items: { $ref: '#/components/schemas/PublicCheckDto' },
    });
    const itemResponse = document.paths['/check/{id}']?.get?.responses?.['200'];
    assert.ok(itemResponse && 'content' in itemResponse);
    assert.deepEqual(itemResponse.content?.['application/json']?.schema, {
      $ref: '#/components/schemas/PublicCheckDto',
    });
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  await assertSwaggerDocument();
  console.log('public check response proof passed');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
