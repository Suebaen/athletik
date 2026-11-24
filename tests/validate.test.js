import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePlan, validateBackup, buildBackup, mergeRecords, fingerprint } from '../js/validate.js';

const planText = readFileSync(new URL('../TrainingPlan.json', import.meta.url), 'utf8');
const fresh = () => JSON.parse(planText);

test('the bundled plan is valid', () => {
  const res = validatePlan(fresh());
  assert.deepEqual(res.errors, []);
  assert.equal(res.ok, true);
});

test('rejects non-objects and missing phases', () => {
  assert.equal(validatePlan(null).ok, false);
  assert.equal(validatePlan([]).ok, false);
  const p = fresh();
  p.phases = [];
  assert.equal(validatePlan(p).ok, false);
});

test('detects a start date that is not a Monday', () => {
  const p = fresh();
  p.phases[1].startDate = '2027-01-12';
  const res = validatePlan(p);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('kein Montag')));
});

test('detects overlapping phases and open phase not last', () => {
  const p = fresh();
  p.phases[0].weeks = 8;
  assert.ok(validatePlan(p).errors.some((e) => e.includes('überschneidet')));
  const q = fresh();
  q.phases[2].weeks = null;
  assert.ok(validatePlan(q).errors.some((e) => e.includes('ist offen')));
});

test('detects unknown session references, bad exercise fields and bad deload weeks', () => {
  const p = fresh();
  p.phases[0].schedule[0].sessionId = 'nope';
  p.phases[0].sessions[0].exercises[0].category = 'cardio';
  p.phases[0].sessions[0].exercises[1].repsMin = null;
  p.phases[0].sessions[0].exercises[1].repsMax = null;
  p.phases[0].deloadWeeks = [9];
  p.phases[0].schedule[1].type = 'swim';
  const errs = validatePlan(p).errors.join('\n');
  assert.match(errs, /sessionId „nope“/);
  assert.match(errs, /category „cardio“/);
  assert.match(errs, /repsMin\/repsMax oder durationSeconds/);
  assert.match(errs, /Deload-Woche 9/);
  assert.match(errs, /type „swim“/);
});

test('detects invalid dates without UTC shifting', () => {
  const p = fresh();
  p.testDates.push('2027-02-30');
  assert.ok(validatePlan(p).errors.some((e) => e.includes('2027-02-30')));
});

const set = (over = {}) => ({
  key: '2026-11-30|back-squat|1', date: '2026-11-30', exerciseId: 'back-squat', setNo: 1,
  reps: 8, seconds: null, weightKg: 60, done: true, updatedAt: 1000, ...over,
});
const result = (over = {}) => ({
  key: '2026-11-30|cmj', date: '2026-11-30', testId: 'cmj', attempts: [60, 62.5, null], best: 62.5, updatedAt: 1000, ...over,
});

test('validateBackup accepts a built backup and rejects broken ones', () => {
  const ok = validateBackup(JSON.parse(JSON.stringify(buildBackup([set()], [result()]))));
  assert.deepEqual(ok.errors, []);
  assert.equal(validateBackup({ app: 'other', schemaVersion: 1, sets: [], tests: [] }).ok, false);
  assert.equal(validateBackup(buildBackup([set({ key: 'wrong' })], [])).ok, false);
  assert.equal(validateBackup(buildBackup([set({ weightKg: -5 })], [])).ok, false);
  assert.equal(validateBackup(buildBackup([], [result({ attempts: ['x'] })])).ok, false);
  assert.equal(validateBackup('nope').ok, false);
});

test('mergeRecords keeps the newer record per key', () => {
  const existing = [set({ updatedAt: 2000 }), set({ key: '2026-11-30|back-squat|2', setNo: 2, updatedAt: 1000 })];
  const incoming = [
    set({ updatedAt: 1500, reps: 1 }), // older → skipped
    set({ key: '2026-11-30|back-squat|2', setNo: 2, updatedAt: 3000, reps: 2 }), // newer → updated
    set({ key: '2026-12-01|back-squat|1', date: '2026-12-01', updatedAt: 10 }), // new → added
  ];
  const res = mergeRecords(existing, incoming);
  assert.equal(res.added, 1);
  assert.equal(res.updated, 1);
  assert.equal(res.skipped, 1);
  assert.deepEqual(res.toWrite.map((r) => r.reps), [2, 8]);
});

test('fingerprint is stable and sensitive', () => {
  assert.equal(fingerprint('abc'), fingerprint('abc'));
  assert.notEqual(fingerprint('abc'), fingerprint('abd'));
});
