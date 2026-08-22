import assert from 'node:assert/strict';
import { alignRecreateDataReferences } from './palmyra.builder';
import type { UTxO } from '@meshsdk/core';
import type { UtxoQuery } from '../types/job.dto.js';

function makeUtxo(txHash: string, outputIndex: number): UTxO {
  return {
    input: { txHash, outputIndex },
    output: {
      address: 'addr_test1_dummy',
      amount: [{ unit: 'lovelace', quantity: '1000000' }],
    },
  } as unknown as UTxO;
}

const requestUtxos: UtxoQuery[] = [
  { txHash: 'a'.repeat(64), outputIndex: 0 },
  { txHash: 'b'.repeat(64), outputIndex: 0 },
  { txHash: 'a'.repeat(64), outputIndex: 1 },
];
const newDataReferences = ['dataA0', 'dataB0', 'dataA1'];

// Library reorders grouped by hash first occurrence: [a#0, a#1, b#0]
const fetchedUtxos: UTxO[] = [
  makeUtxo('a'.repeat(64), 0),
  makeUtxo('a'.repeat(64), 1),
  makeUtxo('b'.repeat(64), 0),
];

const aligned = alignRecreateDataReferences(requestUtxos, newDataReferences, fetchedUtxos);

// expected mapping: a#0->dataA0, b#0->dataB0, a#1->dataA1
// but aligned order is a#0, a#1, b#0 => [hexA0, hexA1, hexB0]
const expectedAligned = [
  Buffer.from('dataA0', 'utf8').toString('hex'),
  Buffer.from('dataA1', 'utf8').toString('hex'),
  Buffer.from('dataB0', 'utf8').toString('hex'),
];

assert.deepEqual(aligned, expectedAligned, 'aligned references must follow fetched order with caller pairing');
assert.equal(aligned.length, 3);

// Missing key should throw named error
let threw = false;
try {
  alignRecreateDataReferences(requestUtxos, newDataReferences, [
    makeUtxo('c'.repeat(64), 0),
  ]);
} catch (e) {
  threw = true;
  assert.match((e as Error).message, /Missing data reference/);
}
assert.equal(threw, true, 'missing key must throw');

console.log('C-2 alignment check passed');
