// Proves bounded lexical scan, instanceof, canonical bytes, and HTTP+Pinata capture.
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { json, raw, urlencoded } from 'express';
import { LosslessNumber } from 'lossless-json';
import { matchesApiKey } from '../api-key.guard';
import {
  IPFS_CANONICAL_BODY,
  canonicalJson,
  prepareIpfsBody,
} from './lossless-json';
import { IpfsController } from './ipfs.controller';
import { IpfsService } from './ipfs.service';

async function testLosslessHelpers(): Promise<void> {
  assert.throws(
    () => prepareIpfsBody(Buffer.from('{"a":1,"a":2}')),
    BadRequestException,
  );
  const empty = prepareIpfsBody(Buffer.from('{}'));
  const protoOnly = prepareIpfsBody(Buffer.from('{"__proto__":1.00e0}'));
  assert.equal(empty.canonical.toString(), '{}');
  assert.equal(protoOnly.canonical.toString(), '{"__proto__":1}');
  assert.notEqual(empty.canonical.toString(), protoOnly.canonical.toString());
  const protoBody = protoOnly.body as Record<string, unknown>;
  assert.equal(Object.hasOwn(protoBody, '__proto__'), true);
  assert.equal(protoBody.__proto__, 1);
  assert.equal(Object.getPrototypeOf(protoBody), Object.prototype);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);

  const reservedRaw =
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"admin":true}},"prototype":"literal","nested":{"__proto__":7},"array":[{"__proto__":"x"},{"constructor":"y","prototype":"z"}]}';
  const reserved = prepareIpfsBody(Buffer.from(reservedRaw));
  assert.equal(
    reserved.canonical.toString(),
    '{"__proto__":{"polluted":true},"array":[{"__proto__":"x"},{"constructor":"y","prototype":"z"}],"constructor":{"prototype":{"admin":true}},"nested":{"__proto__":7},"prototype":"literal"}',
  );
  const reservedBody = reserved.body as Record<string, unknown>;
  assert.equal(Object.hasOwn(reservedBody, '__proto__'), true);
  assert.deepEqual(Object.keys(reservedBody), [
    '__proto__',
    'constructor',
    'prototype',
    'nested',
    'array',
  ]);
  assert.equal(
    Object.getOwnPropertyDescriptor(reservedBody, '__proto__')?.enumerable,
    true,
  );
  assert.deepEqual(reservedBody.__proto__, { polluted: true });
  assert.deepEqual(reservedBody.constructor, { prototype: { admin: true } });
  assert.equal(reservedBody.prototype, 'literal');
  assert.equal(Object.hasOwn(reservedBody.nested as object, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(reservedBody.nested), Object.prototype);
  assert.equal(
    Object.hasOwn((reservedBody.array as object[])[0], '__proto__'),
    true,
  );
  assert.equal(
    Object.getPrototypeOf((reservedBody.array as object[])[0]),
    Object.prototype,
  );
  assert.equal(
    Object.getPrototypeOf((reservedBody.array as object[])[1]),
    Object.prototype,
  );
  assert.deepEqual(({} as Record<string, unknown>).polluted, undefined);
  assert.throws(
    () =>
      prepareIpfsBody(
        Buffer.from('{"nested":{"__proto__":1,"\\u005f\\u005fproto__":2}}'),
      ),
    BadRequestException,
  );
  for (const key of ['constructor', 'prototype']) {
    assert.throws(
      () =>
        prepareIpfsBody(
          Buffer.from('{"array":[{"' + key + '":1,"' + key + '":2}]}'),
        ),
      BadRequestException,
    );
  }
  let deep = '';
  for (let i = 0; i < 101; i++) deep += '{"a":';
  deep += '1' + '}'.repeat(101);
  assert.throws(
    () => prepareIpfsBody(Buffer.from(deep)),
    (e: unknown) => {
      assert.match(
        String((e as Error).message),
        /structure is too complex|Invalid JSON/,
      );
      return true;
    },
  );
  const manyNodes = '[' + Array(100_001).fill('1').join(',') + ']';
  assert.throws(
    () => prepareIpfsBody(Buffer.from(manyNodes)),
    BadRequestException,
  );
  const hugeToken = '"' + 'a'.repeat(1024 * 1024 + 1) + '"';
  assert.throws(
    () => prepareIpfsBody(Buffer.from('{"k":' + hugeToken + '}')),
    BadRequestException,
  );
  const longNum = '1' + '0'.repeat(1025);
  assert.throws(
    () => prepareIpfsBody(Buffer.from('{"n":' + longNum + '}')),
    BadRequestException,
  );
  assert.throws(
    () => prepareIpfsBody(Buffer.from('{"n":1e1000001}')),
    BadRequestException,
  );
  assert.throws(
    () => prepareIpfsBody(Buffer.from('{"n":1e-1000001}')),
    BadRequestException,
  );
  const forms = [
    Buffer.from('{"logTime":"2026-08-26T00:00:00.000Z","events":[{"n":1}]}'),
    Buffer.from('{"logTime":"2026-08-26T00:00:00.000Z","events":[{"n":1.0}]}'),
    Buffer.from('{"logTime":"2026-08-26T00:00:00.000Z","events":[{"n":1e0}]}'),
    Buffer.from(
      '{"logTime":"2026-08-26T00:00:00.000Z","events":[{"n":1.00e0}]}',
    ),
  ];
  const canonicals = forms.map((b) =>
    prepareIpfsBody(b as Buffer).canonical.toString(),
  );
  for (const c of canonicals)
    assert.equal(
      c,
      canonicals[0],
      'equivalent forms must canonicalize together',
    );
  const unsafeA = prepareIpfsBody(
    Buffer.from('{"n":9007199254740992}'),
  ).canonical.toString();
  const unsafeB = prepareIpfsBody(
    Buffer.from('{"n":9007199254740993}'),
  ).canonical.toString();
  assert.notEqual(unsafeA, unsafeB, 'adjacent unsafe ints must differ');
  const exp = prepareIpfsBody(Buffer.from('{"n":1e6}')).canonical.toString();
  assert.equal(exp, '{"n":1e6}');
  assert.ok(exp.length < 100, 'exponent canonical must be bounded');
  const real = new LosslessNumber('123');
  const fake = {
    value: '123',
    isLosslessNumber: true,
  } as unknown as LosslessNumber;
  const realCanon = canonicalJson({ n: real });
  const fakeCanon = canonicalJson({ n: fake as unknown });
  assert.notEqual(
    realCanon,
    fakeCanon,
    'duck typed number must not equal instanceof',
  );
  assert.equal(realCanon, '{"n":123}');
  assert.equal(fakeCanon, '{"n":{"isLosslessNumber":true,"value":"123"}}');
  const raw1 = Buffer.from('{"b":2,"a":1}');
  const raw2 = Buffer.from('{"a":1,"b":2}');
  assert.equal(
    prepareIpfsBody(raw1).canonical.toString(),
    prepareIpfsBody(raw2).canonical.toString(),
  );
}

async function testHttp(): Promise<void> {
  const apiKey = 'test-key-123';
  process.env.WINTER_API_KEY = apiKey;
  process.env.PINATA_JWT = 'jwt';
  process.env.NEXT_PUBLIC_GATEWAY_URL = 'https://example.com';

  const captured: { value?: Buffer } = {};
  let errorLogs: string[] = [];

  class FakeIpfsService {
    async storeJson(json: unknown): Promise<string> {
      const b = canonicalJson(json);
      captured.value = Buffer.from(b);
      return 'bafkreifake';
    }
    async storeCanonical(canonical: Buffer): Promise<string> {
      captured.value = canonical;
      return 'bafkreifake';
    }
  }

  const moduleRef = await Test.createTestingModule({
    controllers: [IpfsController],
    providers: [{ provide: IpfsService, useClass: FakeIpfsService }],
  }).compile();

  const app = moduleRef.createNestApplication();
  const expected = Buffer.from(apiKey);
  app.use((req: any, res: any, next: any) => {
    if (!matchesApiKey(expected, req.get('x-api-key'))) {
      res.status(403).json({ statusCode: 403, message: 'Forbidden resource' });
      return;
    }
    next();
  });
  app.use('/ipfs', raw({ limit: '50mb', type: 'application/json' }));
  app.use('/ipfs', (req: any, _res: any, next: any) => {
    if (!Buffer.isBuffer(req.body)) {
      next();
      return;
    }
    try {
      const { body, canonical } = prepareIpfsBody(req.body);
      (req as any)[IPFS_CANONICAL_BODY] = canonical;
      req.body = body;
      next();
    } catch (e) {
      next(
        e instanceof BadRequestException
          ? e
          : new BadRequestException('Invalid JSON body'),
      );
    }
  });
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const controller = app.get(IpfsController);
  (controller as any).logger.error = (...args: unknown[]) => {
    errorLogs.push(String(args[0]));
  };
  await app.init();

  const malformedNoKey = await request(app.getHttpServer())
    .post('/ipfs')
    .set('Content-Type', 'application/json')
    .send('not json');
  assert.equal(
    malformedNoKey.status,
    403,
    'missing api key must be 403 even for malformed json',
  );

  errorLogs = [];
  const malformedWithKey = await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send('not json');
  assert.equal(malformedWithKey.status, 400, 'malformed json must be 400');
  assert.equal(errorLogs.length, 0, 'BadRequest must not emit ERROR log');

  errorLogs = [];
  const dup = await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send(
      '{"logTime":"2026-08-26T00:00:00.000Z","events":[{"a":1}],"logTime":"dup"}',
    );
  assert.equal(dup.status, 400);
  assert.equal(errorLogs.length, 0);

  errorLogs = [];
  const noLogTime = await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send({ events: [{ a: 1 }] } as any);
  assert.equal(noLogTime.status, 400);
  assert.equal(errorLogs.length, 0);

  captured.value = undefined;
  const unsafeRaw =
    '{"logTime":"2026-08-26T00:00:00.000Z","events":[{"value":9007199254740993}]}';
  const success = await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send(unsafeRaw);
  assert.equal(success.status, 201);
  assert.match(success.body.hash, /^bafkreifake$/);
  assert.ok(captured.value, 'must capture File bytes');
  assert.equal(
    (captured.value as unknown as Buffer).toString(),
    '{"events":[{"value":9007199254740993}],"logTime":"2026-08-26T00:00:00.000Z"}',
    'canonical must be sorted keys and preserve unsafe int string',
  );
  assert.ok(
    (captured.value as unknown as Buffer)
      .toString()
      .includes('9007199254740993'),
  );

  captured.value = undefined;
  const reservedHttpRaw =
    '{"logTime":"2026-08-26T00:00:00.000Z","events":[{"__proto__":{"polluted":true},"array":[{"__proto__":1}],"constructor":{"prototype":2},"prototype":3}]}';
  const reservedSuccess = await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send(reservedHttpRaw);
  assert.equal(reservedSuccess.status, 201);
  assert.equal(
    (captured.value as unknown as Buffer).toString(),
    '{"events":[{"__proto__":{"polluted":true},"array":[{"__proto__":1}],"constructor":{"prototype":2},"prototype":3}],"logTime":"2026-08-26T00:00:00.000Z"}',
    'HTTP and Pinata bytes must preserve every reserved key',
  );
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);

  captured.value = undefined;
  const formA = '{"logTime":"2026-08-26T00:00:00.000Z","events":[{"n":1}]}';
  const formB = '{"logTime":"2026-08-26T00:00:00.000Z","events":[{"n":1.0}]}';
  await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send(formA);
  const capA = (captured.value as unknown as Buffer).toString();
  await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send(formB);
  const capB = (captured.value as unknown as Buffer).toString();
  assert.equal(
    capA,
    capB,
    'equivalent numeric forms must produce same File bytes via HTTP',
  );

  await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send(
      '{"logTime":"2026-08-26T00:00:00.000Z","events":[{"n":9007199254740992}]}',
    );
  const capUnsafeA = (captured.value as unknown as Buffer).toString();
  await request(app.getHttpServer())
    .post('/ipfs')
    .set('x-api-key', apiKey)
    .set('Content-Type', 'application/json')
    .send(
      '{"logTime":"2026-08-26T00:00:00.000Z","events":[{"n":9007199254740993}]}',
    );
  const capUnsafeB = (captured.value as unknown as Buffer).toString();
  assert.notEqual(capUnsafeA, capUnsafeB);

  await app.close();
}

async function main(): Promise<void> {
  await testLosslessHelpers();
  await testHttp();
  console.log('ipfs proof passed');
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
