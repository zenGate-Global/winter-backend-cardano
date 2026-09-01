import assert from 'node:assert/strict';
import { TransactionsService } from './transactions.service';
import type { Transaction } from './entities/transaction.entity';

async function main() {
  const rows = Array.from({ length: 120 }, (_, index) => ({
    txid: index.toString().padStart(64, '0'),
    recreated: [],
    spent: '',
  })) as unknown as Transaction[];

  const repository = {
    find: async ({
      take,
      skip,
      order,
    }: {
      take: number;
      skip: number;
      order?: { txid: 'ASC' | 'DESC' };
    }) => {
      assert.deepEqual(order, { txid: 'ASC' });
      return [...rows]
        .sort((left, right) => left.txid.localeCompare(right.txid))
        .slice(skip, skip + take);
    },
  };

  const service = new TransactionsService(repository as never, {} as never);
  const first = await service.findAll(50, 0);
  rows[10].spent = 'updated';
  const second = await service.findAll(50, 50);
  const repeatedFirst = await service.findAll(50, 0);

  assert.deepEqual(
    repeatedFirst.map(({ txid }) => txid),
    first.map(({ txid }) => txid),
  );
  assert.equal(
    new Set([...first, ...second].map(({ txid }) => txid)).size,
    100,
  );
  console.log('transaction pagination proof passed');
}

void main();
