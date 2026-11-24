// Set logs on top of db.js. Records reference exercise ids and dates only,
// never positions in the plan, so they survive plan updates.

import * as db from './db.js';

export function setKey(date, exerciseId, setNo) {
  return `${date}|${exerciseId}|${setNo}`;
}

/** Map<key, record> of all sets logged on `date`. */
export async function setsForDate(date) {
  const records = await db.getAllByIndex('sets', 'date', date);
  return new Map(records.map((r) => [r.key, r]));
}

export async function setsForExercise(exerciseId) {
  return db.getAllByIndex('sets', 'exerciseId', exerciseId);
}

export function saveSet(record) {
  return db.put('sets', { ...record, updatedAt: Date.now() });
}

export function deleteSet(key) {
  return db.del('sets', key);
}

/**
 * Last logged weight for an exercise, excluding `date` itself.
 * Prefers the latest session before `date`; falls back to later sessions
 * (when logging a forgotten past day). Within a session the highest set
 * number with a weight wins.
 */
export async function lastWeight(exerciseId, date) {
  const records = (await setsForExercise(exerciseId)).filter((r) => r.weightKg != null && r.date !== date);
  if (records.length === 0) return null;
  const byRecency = (a, b) => (a.date === b.date ? b.setNo - a.setNo : a.date < b.date ? 1 : -1);
  const before = records.filter((r) => r.date < date).sort(byRecency);
  if (before.length) return before[0].weightKg;
  return records.sort(byRecency)[0].weightKg;
}
