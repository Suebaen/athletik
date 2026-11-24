import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/timerstate.js';

const t0 = 1_800_000_000_000;

test('startTimer and remaining time are timestamp based', () => {
  const s = T.startTimer(90, t0, { exerciseId: 'back-squat' });
  assert.equal(s.endsAt, t0 + 90000);
  assert.equal(s.exerciseId, 'back-squat');
  assert.equal(T.remainingMs(s, t0 + 30000), 60000);
  // App suspended for 10 minutes: no negative values, finished.
  assert.equal(T.remainingMs(s, t0 + 600000), 0);
  assert.equal(T.isFinished(s, t0 + 600000), true);
  assert.equal(T.isFinished(s, t0 + 89999), false);
});

test('remainingFraction', () => {
  const s = T.startTimer(100, t0);
  assert.equal(T.remainingFraction(s, t0), 1);
  assert.equal(T.remainingFraction(s, t0 + 25000), 0.75);
  assert.equal(T.remainingFraction(s, t0 + 200000), 0);
  assert.equal(T.remainingFraction(T.startTimer(0, t0), t0), 0);
});

test('adjustTimer adds and removes time but never ends in the past', () => {
  const s = T.startTimer(60, t0);
  const plus = T.adjustTimer(s, 15000, t0 + 10000);
  assert.equal(plus.endsAt, t0 + 75000);
  assert.equal(plus.durationMs, 75000);
  const minus = T.adjustTimer(s, -15000, t0 + 10000);
  assert.equal(minus.endsAt, t0 + 45000);
  const clamp = T.adjustTimer(s, -60000, t0 + 50000);
  assert.equal(clamp.endsAt, t0 + 50000);
});

test('restoreAction', () => {
  const s = T.startTimer(60, t0);
  assert.equal(T.restoreAction(s, t0 + 1000), 'running');
  assert.equal(T.restoreAction(s, t0 + 61000), 'finished');
  assert.equal(T.restoreAction(s, t0 + 60000 + 3 * 60000), 'discard');
  assert.equal(T.restoreAction(null, t0), 'discard');
  assert.equal(T.restoreAction({}, t0), 'discard');
});
