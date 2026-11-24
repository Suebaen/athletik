import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestAttempt, testSeries, topSetsByDate } from '../js/stats.js';
import { chartModel, niceStep } from '../js/svgchart.js';

test('bestAttempt', () => {
  assert.equal(bestAttempt([60, 62.5, null]), 62.5);
  assert.equal(bestAttempt([null, null]), null);
  assert.equal(bestAttempt(undefined), null);
});

test('testSeries filters and sorts', () => {
  const recs = [
    { testId: 'cmj', date: '2026-12-18', best: 63 },
    { testId: 'cmj', date: '2026-11-30', best: 60 },
    { testId: 'broad-jump', date: '2026-11-30', best: 250 },
    { testId: 'cmj', date: '2027-01-29', best: null },
  ];
  assert.deepEqual(testSeries(recs, 'cmj'), [{ date: '2026-11-30', best: 60 }, { date: '2026-12-18', best: 63 }]);
});

test('topSetsByDate picks heaviest set (ties → more reps)', () => {
  const recs = [
    { date: '2026-12-07', setNo: 1, weightKg: 60, reps: 8 },
    { date: '2026-12-07', setNo: 2, weightKg: 65, reps: 6 },
    { date: '2026-12-07', setNo: 3, weightKg: 65, reps: 7 },
    { date: '2026-11-30', setNo: 1, weightKg: 60, reps: 8 },
    { date: '2026-11-30', setNo: 2, weightKg: null, reps: 8 },
  ];
  const res = topSetsByDate(recs, { trackWeight: true });
  assert.deepEqual(res.map((r) => [r.date, r.value, r.top.setNo]), [['2026-11-30', 60, 1], ['2026-12-07', 65, 3]]);
  assert.equal(res[0].sets.length, 2);
});

test('topSetsByDate without weight uses reps or seconds', () => {
  const res = topSetsByDate([
    { date: '2026-12-01', setNo: 1, reps: 4 },
    { date: '2026-12-01', setNo: 2, reps: 6 },
    { date: '2026-12-02', setNo: 1, seconds: 25 },
    { date: '2026-12-03', setNo: 1, done: true },
  ], { trackWeight: false });
  assert.deepEqual(res.map((r) => r.value), [6, 25, null]);
});

test('niceStep', () => {
  assert.equal(niceStep(20), 5);
  assert.equal(niceStep(8), 2);
  assert.equal(niceStep(100), 25);
  assert.equal(niceStep(0), 1);
});

test('chartModel includes the goal in the y range and maps dates to x', () => {
  const m = chartModel([
    { date: '2026-11-30', value: 60 },
    { date: '2027-01-29', value: 64 },
  ], { width: 340, height: 180, goal: 75 });
  assert.ok(m.ticks[0].value <= 60);
  assert.ok(m.ticks.at(-1).value >= 75);
  assert.equal(m.coords[0].x, m.pad.left);
  assert.equal(m.coords[1].x, 340 - m.pad.right);
  assert.ok(m.goalY < m.coords[1].y); // goal is above the latest value
  assert.ok(m.path.startsWith('M'));
});

test('chartModel with a single point or none', () => {
  const one = chartModel([{ date: '2026-11-30', value: 60 }]);
  assert.equal(one.coords.length, 1);
  assert.equal(one.xLabels.length, 1);
  const none = chartModel([]);
  assert.equal(none.coords.length, 0);
  assert.equal(none.path, '');
});
