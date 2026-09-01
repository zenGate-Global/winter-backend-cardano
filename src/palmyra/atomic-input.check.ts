import 'reflect-metadata';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PalmyraController } from './palmyra.controller';
import { PalmyraService } from './palmyra.service';
import { CheckService } from '../check/check.service';
import { SpendCommodityDto } from './dto/spend-commodity.dto';
import { RecreateCommodityDto } from './dto/recreate-commodity.dto';

const validHash = 'abcdef0123456789'.repeat(4);

type Counters = {
  dispatch: number;
  db: number;
  queue: number;
  provider: number;
  build: number;
};

const counters: Counters = {
  dispatch: 0,
  db: 0,
  queue: 0,
  provider: 0,
  build: 0,
};

function resetCounters(): void {
  for (const key of Object.keys(counters) as (keyof Counters)[]) {
    counters[key] = 0;
  }
}

function assertZeroCounters(): void {
  assert.deepEqual(counters, {
    dispatch: 0,
    db: 0,
    queue: 0,
    provider: 0,
    build: 0,
  });
}

async function recordDispatch(): Promise<void> {
  counters.dispatch++;
  counters.db++;
  counters.queue++;
  counters.provider++;
  counters.build++;
}

const palmyraService = {
  dispatchSpendCommodity: recordDispatch,
  dispatchRecreateCommodity: recordDispatch,
} as unknown as PalmyraService;

const checkService = {
  findOne: async (): Promise<null> => {
    counters.db++;
    return null;
  },
  exists: async (): Promise<boolean> => {
    counters.db++;
    return false;
  },
  create: async (): Promise<void> => {
    counters.db++;
  },
} as unknown as CheckService;

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

const controller = new PalmyraController(palmyraService, checkService);

async function expectPipeRejects(
  body: unknown,
  metatype: new (...args: unknown[]) => unknown,
): Promise<void> {
  resetCounters();
  await assert.rejects(
    pipe.transform(body, { type: 'body', metatype, data: '' } as never),
    (error: unknown) =>
      error instanceof BadRequestException && error.getStatus() === 400,
  );
  assertZeroCounters();
}

async function expectControllerRejects(
  fn: () => Promise<unknown>,
): Promise<void> {
  resetCounters();
  await assert.rejects(fn, (error: unknown) => {
    if (error instanceof BadRequestException) {
      assert.equal(error.getStatus(), 400);
      return true;
    }
    const status = (error as { getStatus?: () => number })?.getStatus?.();
    assert.equal(status, 400);
    return true;
  });
  assertZeroCounters();
}

async function main(): Promise<void> {
  // 1) malformed mixed nested UTxO input: one valid, one syntactically invalid
  await expectPipeRejects(
    {
      utxos: [
        { txHash: validHash, outputIndex: 0 },
        { txHash: 'not-a-transaction-hash', outputIndex: 'one' },
      ],
    },
    SpendCommodityDto as never,
  );

  // 2) duplicate valid normalized outref: same hash different case
  {
    resetCounters();
    const body = {
      utxos: [
        { txHash: validHash, outputIndex: 0 },
        { txHash: validHash.toUpperCase(), outputIndex: 0 },
      ],
    };
    const dto = (await pipe.transform(body, {
      type: 'body',
      metatype: SpendCommodityDto,
      data: '',
    } as never)) as SpendCommodityDto;
    // DTO passes, controller must reject duplicate normalized identity
    await expectControllerRejects(() =>
      controller.spendCommodity(dto, undefined, {
        setHeader: () => {},
      } as never),
    );
    // Re-establish zero after the DTO step produced no side effects
    // The transform itself must also produce zero calls
    assertZeroCounters();
  }
  // 3) recreate duplicate valid normalized outref: same hash different case
  {
    resetCounters();
    const body = {
      utxos: [
        { txHash: validHash, outputIndex: 0 },
        { txHash: validHash.toUpperCase(), outputIndex: 0 },
      ],
      newDataReferences: ['ipfs://first', 'ipfs://second'],
    };
    const dto = (await pipe.transform(body, {
      type: 'body',
      metatype: RecreateCommodityDto,
      data: '',
    } as never)) as RecreateCommodityDto;
    await expectControllerRejects(() =>
      controller.recreateCommodity(dto, undefined, {
        setHeader: () => {},
      } as never),
    );
    assertZeroCounters();
  }

  // 4) mismatched arrays: utxos length 1 vs newDataReferences length 2
  {
    resetCounters();
    const body = {
      utxos: [{ txHash: validHash, outputIndex: 0 }],
      newDataReferences: ['ipfs://first', 'ipfs://second'],
    };
    const dto = (await pipe.transform(body, {
      type: 'body',
      metatype: RecreateCommodityDto,
      data: '',
    } as never)) as RecreateCommodityDto;
    await expectControllerRejects(() =>
      controller.recreateCommodity(dto, undefined, {
        setHeader: () => {},
      } as never),
    );
    assertZeroCounters();
  }

  // 5) 101 entries: exceeds ArrayMaxSize(100)
  await expectPipeRejects(
    {
      utxos: Array.from({ length: 101 }, (_, outputIndex) => ({
        txHash: outputIndex.toString(16).padStart(64, '0'),
        outputIndex,
      })),
      newDataReferences: Array.from(
        { length: 101 },
        (_, i) => `ipfs://reference-${i}`,
      ),
    },
    RecreateCommodityDto as never,
  );

  console.log('atomic input validation check passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
