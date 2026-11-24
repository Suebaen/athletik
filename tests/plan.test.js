import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from '../js/plan.js';

const plan = JSON.parse(readFileSync(new URL('../TrainingPlan.json', import.meta.url), 'utf8'));
const ex = (fields) => ({ sets: 3, repsMin: null, repsMax: null, durationSeconds: null, perSide: false, groupId: null, ...fields });

test('parseDate rejects malformed and impossible dates', () => {
  assert.deepEqual(P.parseDate('2026-11-30'), { y: 2026, m: 11, d: 30 });
  assert.equal(P.parseDate('2026-2-3'), null);
  assert.equal(P.parseDate('2027-02-29'), null);
  assert.equal(P.parseDate('2026-13-01'), null);
  assert.equal(P.parseDate(''), null);
  assert.equal(P.parseDate(null), null);
  assert.ok(P.parseDate('2028-02-29'));
});

test('day arithmetic across month, year and DST boundaries', () => {
  assert.equal(P.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(P.addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(P.addDays('2027-03-27', 2), '2027-03-29'); // EU DST switch on 28 Mar
  assert.equal(P.addDays('2026-10-24', 2), '2026-10-26'); // DST end
  assert.equal(P.daysBetween('2026-11-24', '2026-11-30'), 6);
});

test('weekday is ISO (Monday = 1)', () => {
  assert.equal(P.weekday('2026-11-30'), 1);
  assert.equal(P.weekday('2026-12-06'), 7);
  assert.equal(P.weekday('2027-01-29'), 5);
  assert.equal(P.mondayOf('2026-12-06'), '2026-11-30');
});

test('toDateString uses local date parts', () => {
  assert.equal(P.toDateString(new Date(2026, 10, 30, 23, 59)), '2026-11-30');
  assert.equal(P.toDateString(new Date(2027, 0, 1, 0, 0)), '2027-01-01');
});

test('formatDateDE', () => {
  assert.equal(P.formatDateDE('2026-11-30'), 'Mo, 30.11.2026');
  assert.equal(P.formatDateDE('2026-12-06', { withYear: false, longWeekday: true }), 'Sonntag, 06.12.');
});

test('all phase start dates in the plan are Mondays and phases are contiguous', () => {
  const phases = P.sortedPhases(plan);
  for (const p of phases) assert.equal(P.weekday(p.startDate), 1, p.id);
  for (let i = 0; i < phases.length - 1; i++) {
    assert.equal(P.addDays(P.phaseEndDate(phases[i]), 1), phases[i + 1].startDate);
  }
  assert.equal(P.phaseEndDate(phases.at(-1)), null);
});

test('dayInfo before the plan starts', () => {
  const info = P.dayInfo(plan, '2026-11-24');
  assert.equal(info.status, 'before');
  assert.equal(info.startsIn, 6);
  assert.equal(info.nextTestDate, '2026-11-30');
});

test('dayInfo on the first day', () => {
  const info = P.dayInfo(plan, '2026-11-30');
  assert.equal(info.status, 'active');
  assert.equal(info.phase.id, 'p1');
  assert.equal(info.weekNo, 1);
  assert.equal(info.totalWeeks, 6);
  assert.equal(info.isDeload, false);
  assert.equal(info.isTestDay, true);
  assert.equal(info.entry.type, 'gym');
  assert.equal(info.session.id, 'p1-a');
});

test('dayInfo deload week and phase boundaries', () => {
  // p1 week 4 starts 2026-12-21
  assert.equal(P.dayInfo(plan, '2026-12-21').isDeload, true);
  assert.equal(P.dayInfo(plan, '2026-12-27').isDeload, true);
  assert.equal(P.dayInfo(plan, '2026-12-28').isDeload, false);
  const lastP1 = P.dayInfo(plan, '2027-01-10');
  assert.equal(lastP1.phase.id, 'p1');
  assert.equal(lastP1.weekNo, 6);
  const firstP2 = P.dayInfo(plan, '2027-01-11');
  assert.equal(firstP2.phase.id, 'p2');
  assert.equal(firstP2.weekNo, 1);
  // p3 has two deload weeks: 4 and 8
  assert.equal(P.dayInfo(plan, '2027-04-19').weekNo, 8);
  assert.equal(P.dayInfo(plan, '2027-04-19').isDeload, true);
});

test('dayInfo rest, ultimate and optional days', () => {
  const thu = P.dayInfo(plan, '2026-12-03');
  assert.equal(thu.entry.type, 'rest');
  assert.equal(thu.session, null);
  assert.equal(thu.entry.note, 'Locker bewegen, Mobility');
  const wed = P.dayInfo(plan, '2026-12-02');
  assert.equal(wed.entry.type, 'ultimate');
  assert.equal(wed.session.id, 'p1-u');
  const sat = P.dayInfo(plan, '2026-12-05');
  assert.equal(sat.entry.type, 'optional');
  assert.equal(sat.session, null);
});

test('open-ended season phase', () => {
  const info = P.dayInfo(plan, '2027-09-08'); // a Wednesday, far into the season
  assert.equal(info.status, 'active');
  assert.equal(info.phase.id, 'p4');
  assert.equal(info.totalWeeks, null);
  assert.equal(info.weekNo, 20);
  assert.equal(info.session.id, 'p4-b');
  assert.equal(P.weekLabel(20, null), 'Woche 20');
  assert.equal(P.weekLabel(3, 6), 'Woche 3 von 6');
});

test('status after and gap for finite / non-contiguous plans', () => {
  const finite = {
    phases: [
      { id: 'a', startDate: '2026-01-05', weeks: 1, deloadWeeks: [], schedule: [], sessions: [] },
      { id: 'b', startDate: '2026-01-19', weeks: 1, deloadWeeks: [], schedule: [], sessions: [] },
    ],
  };
  assert.equal(P.dayInfo(finite, '2026-01-14').status, 'gap');
  assert.equal(P.dayInfo(finite, '2026-01-26').status, 'after');
  assert.equal(P.dayInfo({ phases: [] }, '2026-01-26').status, 'gap');
});

test('plannedSets in deload weeks', () => {
  assert.equal(P.plannedSets(ex({ sets: 4 }), false, 0.5), 4);
  assert.equal(P.plannedSets(ex({ sets: 4 }), true, 0.5), 2);
  assert.equal(P.plannedSets(ex({ sets: 3 }), true, 0.5), 2);
  assert.equal(P.plannedSets(ex({ sets: 5 }), true, 0.5), 3);
  assert.equal(P.plannedSets(ex({ sets: 1 }), true, 0.5), 1);
  assert.equal(P.plannedSets(ex({ sets: 2 }), true, 0.1), 1);
  assert.equal(P.setsFactorOf(plan), 0.5);
});

test('prescriptionText', () => {
  assert.equal(P.prescriptionText(ex({ sets: 4, repsMin: 6, repsMax: 8 })), '4 × 6–8');
  assert.equal(P.prescriptionText(ex({ sets: 3, repsMin: 8, repsMax: 8 })), '3 × 8');
  assert.equal(P.prescriptionText(ex({ sets: 3, repsMin: 8, repsMax: 8, perSide: true })), '3 × 8 pro Seite');
  assert.equal(P.prescriptionText(ex({ sets: 3, durationSeconds: 20, perSide: true })), '3 × 20 s pro Seite');
  assert.equal(P.prescriptionText(ex({ sets: 4, repsMin: 6, repsMax: 8 }), 2), '2 × 6–8');
  assert.equal(P.prescriptionText(ex({ sets: 2 })), '2 Sätze');
});

test('formatRest and formatCountdown', () => {
  assert.equal(P.formatRest(45), '45 s');
  assert.equal(P.formatRest(90), '90 s');
  assert.equal(P.formatRest(60), '1 min');
  assert.equal(P.formatRest(120), '2 min');
  assert.equal(P.formatRest(150), '2:30 min');
  assert.equal(P.formatCountdown(90000), '1:30');
  assert.equal(P.formatCountdown(500), '0:01');
  assert.equal(P.formatCountdown(-10), '0:00');
});

test('groupExercises groups contrast pairs', () => {
  const p3a = plan.phases.find((p) => p.id === 'p3').sessions.find((s) => s.id === 'p3-a');
  const blocks = P.groupExercises(p3a.exercises);
  assert.equal(blocks.length, 5);
  assert.equal(blocks[0].groupId, 'k1');
  assert.deepEqual(blocks[0].exercises.map((e) => e.id), ['back-squat', 'box-jump']);
  assert.equal(blocks[1].groupId, null);
});

test('blockSetOrder alternates sets within a contrast pair', () => {
  const block = { groupId: 'k1', exercises: [ex({ id: 'a', sets: 3 }), ex({ id: 'b', sets: 3 })] };
  const order = P.blockSetOrder(block, false, 0.5).map((o) => `${o.exercise.id}${o.setNo}`);
  assert.deepEqual(order, ['a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
  const deload = P.blockSetOrder(block, true, 0.5).map((o) => `${o.exercise.id}${o.setNo}`);
  assert.deepEqual(deload, ['a1', 'b1', 'a2', 'b2']);
});

test('browsableWeeks', () => {
  const [p1, , , p4] = P.sortedPhases(plan);
  assert.equal(P.browsableWeeks(p1, '2026-11-24').length, 6);
  assert.equal(P.browsableWeeks(p4, '2026-11-24').length, 8);
  assert.equal(P.browsableWeeks(p4, '2027-09-08').length, 24);
});

test('exerciseCatalog uses the latest name and merges phases', () => {
  const cat = P.exerciseCatalog(plan);
  assert.equal(cat.get('box-jump').name, 'Box Jumps');
  assert.deepEqual(cat.get('box-jump').phaseIds, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(cat.get('back-squat').trackWeight, true);
  assert.equal(cat.get('copenhagen-plank').timed, true);
});

test('nextTestDate', () => {
  assert.equal(P.nextTestDate(plan, '2026-12-01'), '2026-12-18');
  assert.equal(P.nextTestDate(plan, '2026-12-18'), '2026-12-18');
  assert.equal(P.nextTestDate(plan, '2027-05-01'), null);
});
