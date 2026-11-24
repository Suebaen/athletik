import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecimal, parseIntOrNull, formatDecimal, formatSet } from '../js/util.js';

test('parseDecimal accepts comma and dot', () => {
  assert.equal(parseDecimal('62,5'), 62.5);
  assert.equal(parseDecimal('62.5'), 62.5);
  assert.equal(parseDecimal(' 80 '), 80);
  assert.equal(parseDecimal(',5'), 0.5);
  assert.equal(parseDecimal('80,'), 80);
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('abc'), null);
  assert.equal(parseDecimal('-5'), null);
  assert.equal(parseDecimal('1,2,3'), null);
  assert.equal(parseDecimal(null), null);
});

test('parseIntOrNull', () => {
  assert.equal(parseIntOrNull('8'), 8);
  assert.equal(parseIntOrNull('08'), 8);
  assert.equal(parseIntOrNull('8.5'), null);
  assert.equal(parseIntOrNull(''), null);
});

test('formatDecimal', () => {
  assert.equal(formatDecimal(62.5), '62,5');
  assert.equal(formatDecimal(80), '80');
  assert.equal(formatDecimal(null), '');
});

test('formatSet', () => {
  assert.equal(formatSet({ reps: 8, weightKg: 60 }), '8 × 60 kg');
  assert.equal(formatSet({ seconds: 20 }), '20 s');
  assert.equal(formatSet({ reps: 5 }), '5 Wdh.');
  assert.equal(formatSet({ weightKg: 22.5 }), '22,5 kg');
  assert.equal(formatSet({ done: true }), '✓');
});
