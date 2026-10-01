import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectBestOffers } from '../src/dedupe';
import { SUPPLIER_DATA } from '../src/mockSuppliers';
import type { Hotel } from '../src/types';

const h = (name: string, price: number, supplier: string, commissionPct: number): Hotel => ({ name, price, supplier, commissionPct });

test('picks the cheaper offer when a hotel is in both suppliers', () => {
  const out = selectBestOffers([h('Holtin', 6000, 'Supplier A', 10), h('Holtin', 5340, 'Supplier B', 20)]);
  assert.deepEqual(out, [h('Holtin', 5340, 'Supplier B', 20)]);
});

test('keeps hotels that only one supplier returns', () => {
  const out = selectBestOffers([h('Zostel', 1500, 'Supplier B', 18), h('Ibis', 3800, 'Supplier A', 9)]);
  assert.equal(out.length, 2);
});

test('matches names case/whitespace-insensitively', () => {
  const out = selectBestOffers([h('Holtin', 6000, 'Supplier A', 10), h(' HOLTIN ', 5000, 'Supplier B', 10)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].supplier, 'Supplier B');
});

test('price tie -> higher commission wins', () => {
  const out = selectBestOffers([h('Lemon Tree', 4200, 'Supplier A', 11), h('Lemon Tree', 4200, 'Supplier B', 12)]);
  assert.equal(out[0].supplier, 'Supplier B');
});

test('output is sorted by price ascending', () => {
  const out = selectBestOffers([h('X', 300, 'Supplier A', 1), h('Y', 100, 'Supplier B', 1)]);
  assert.deepEqual(out.map((o) => o.name), ['Y', 'X']);
});

test('empty input -> empty output', () => {
  assert.deepEqual(selectBestOffers([]), []);
});

test('mock data contains overlapping hotel names between A and B', () => {
  const a = new Set(SUPPLIER_DATA.A.map((x) => x.name));
  assert.ok(SUPPLIER_DATA.B.some((x) => a.has(x.name)));
});
