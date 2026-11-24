// Pure validation for imported plans and backups, plus backup merge logic.
// Error messages are German because they are shown to the user.

import { parseDate, weekday, dayNumber, phaseEndDate } from './plan.js';

const DAY_TYPES = ['gym', 'ultimate', 'optional', 'rest'];
const CATEGORIES = ['jump', 'strength', 'core', 'prevention', 'skill'];
const MAX_ERRORS = 25;

export const BACKUP_APP = 'athletik';
export const BACKUP_SCHEMA = 1;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isInt = (v) => Number.isInteger(v);
const isPosInt = (v) => isInt(v) && v > 0;
const isNonNegNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isNullOr = (pred) => (v) => v === null || v === undefined || pred(v);

function collector() {
  const errors = [];
  const add = (msg) => { if (errors.length < MAX_ERRORS) errors.push(msg); };
  return { errors, add };
}

// ---------------------------------------------------------------------------
// Plan

/** Validates a TrainingPlan.json object. Returns { ok, errors: string[] }. */
export function validatePlan(plan) {
  const { errors, add } = collector();
  if (!isObj(plan)) return { ok: false, errors: ['Die Datei enthält kein JSON-Objekt.'] };

  if (plan.schemaVersion !== 1) add(`schemaVersion muss 1 sein (ist: ${JSON.stringify(plan.schemaVersion)}).`);
  if (!isStr(plan.title)) add('title fehlt.');

  if (plan.deload !== undefined) {
    const f = plan.deload?.setsFactor;
    if (typeof f !== 'number' || !(f > 0 && f <= 1)) add('deload.setsFactor muss eine Zahl zwischen 0 und 1 sein.');
  }

  const testIds = new Set();
  if (plan.tests !== undefined) {
    if (!Array.isArray(plan.tests)) add('tests muss eine Liste sein.');
    else plan.tests.forEach((t, i) => {
      const where = `tests[${i}]`;
      if (!isObj(t)) { add(`${where} ist kein Objekt.`); return; }
      if (!isStr(t.id)) add(`${where}.id fehlt.`);
      else if (testIds.has(t.id)) add(`Test-ID „${t.id}“ ist doppelt.`);
      else testIds.add(t.id);
      if (!isStr(t.name)) add(`${where}.name fehlt.`);
      if (!isPosInt(t.attempts)) add(`${where}.attempts muss eine positive Ganzzahl sein.`);
    });
  }
  if (plan.testDates !== undefined) {
    if (!Array.isArray(plan.testDates)) add('testDates muss eine Liste sein.');
    else plan.testDates.forEach((d) => { if (!parseDate(d)) add(`Ungültiges Testdatum: ${JSON.stringify(d)}.`); });
  }
  if (plan.goal !== undefined && plan.goal !== null) {
    if (!isObj(plan.goal)) add('goal ist kein Objekt.');
    else {
      if (!testIds.has(plan.goal.testId)) add(`goal.testId „${plan.goal.testId}“ ist kein bekannter Test.`);
      if (typeof plan.goal.target !== 'number') add('goal.target muss eine Zahl sein.');
    }
  }

  if (!Array.isArray(plan.phases) || plan.phases.length === 0) {
    add('phases fehlt oder ist leer.');
    return { ok: false, errors };
  }

  const phaseIds = new Set();
  const validPhases = [];
  plan.phases.forEach((p, i) => {
    const where = isObj(p) && isStr(p.id) ? `Phase „${p.id}“` : `phases[${i}]`;
    if (!isObj(p)) { add(`${where} ist kein Objekt.`); return; }
    let ok = true;
    if (!isStr(p.id)) { add(`${where}: id fehlt.`); ok = false; } else if (phaseIds.has(p.id)) add(`Phasen-ID „${p.id}“ ist doppelt.`);
    phaseIds.add(p.id);
    if (!isStr(p.name)) add(`${where}: name fehlt.`);
    if (!parseDate(p.startDate)) { add(`${where}: startDate ungültig (erwartet yyyy-MM-dd).`); ok = false; }
    else if (weekday(p.startDate) !== 1) add(`${where}: startDate ${p.startDate} ist kein Montag.`);
    if (!(p.weeks === null || isPosInt(p.weeks))) { add(`${where}: weeks muss eine positive Ganzzahl oder null sein.`); ok = false; }
    if (!Array.isArray(p.deloadWeeks)) add(`${where}: deloadWeeks muss eine Liste sein.`);
    else p.deloadWeeks.forEach((w) => {
      if (!isPosInt(w) || (isPosInt(p.weeks) && w > p.weeks)) add(`${where}: Deload-Woche ${JSON.stringify(w)} liegt außerhalb der Phase.`);
    });

    const sessionIds = new Set();
    if (!Array.isArray(p.sessions)) add(`${where}: sessions muss eine Liste sein.`);
    else p.sessions.forEach((s, si) => validateSession(s, `${where}, Einheit ${isObj(s) && isStr(s.id) ? `„${s.id}“` : si + 1}`, sessionIds, add));

    if (!Array.isArray(p.schedule)) add(`${where}: schedule muss eine Liste sein.`);
    else {
      const days = new Set();
      p.schedule.forEach((d, di) => {
        const w = `${where}, schedule[${di}]`;
        if (!isObj(d)) { add(`${w} ist kein Objekt.`); return; }
        if (!isInt(d.weekday) || d.weekday < 1 || d.weekday > 7) add(`${w}: weekday muss 1–7 sein.`);
        else if (days.has(d.weekday)) add(`${w}: Wochentag ${d.weekday} ist doppelt.`);
        days.add(d.weekday);
        if (!DAY_TYPES.includes(d.type)) add(`${w}: type „${d.type}“ unbekannt (erlaubt: ${DAY_TYPES.join(', ')}).`);
        if (d.sessionId != null && !sessionIds.has(d.sessionId)) add(`${w}: sessionId „${d.sessionId}“ gibt es in dieser Phase nicht.`);
        if (d.note != null && typeof d.note !== 'string') add(`${w}: note muss Text sein.`);
      });
    }
    if (ok) validPhases.push(p);
  });

  // Phases must not overlap; only the last one may be open-ended.
  const sorted = [...validPhases].sort((a, b) => dayNumber(a.startDate) - dayNumber(b.startDate));
  sorted.forEach((p, i) => {
    const next = sorted[i + 1];
    if (!next) return;
    const end = phaseEndDate(p);
    if (end === null) add(`Phase „${p.id}“ ist offen (weeks: null), aber danach folgt noch „${next.id}“.`);
    else if (dayNumber(end) >= dayNumber(next.startDate)) add(`Phase „${p.id}“ überschneidet sich mit „${next.id}“.`);
  });

  return { ok: errors.length === 0, errors };
}

function validateSession(s, where, sessionIds, add) {
  if (!isObj(s)) { add(`${where} ist kein Objekt.`); return; }
  if (!isStr(s.id)) add(`${where}: id fehlt.`);
  else if (sessionIds.has(s.id)) add(`${where}: ID ist doppelt.`);
  sessionIds.add(s.id);
  if (!isStr(s.name)) add(`${where}: name fehlt.`);
  if (!Array.isArray(s.exercises)) { add(`${where}: exercises muss eine Liste sein.`); return; }
  const exIds = new Set();
  s.exercises.forEach((e, ei) => {
    const w = `${where}, Übung ${isObj(e) && isStr(e.id) ? `„${e.id}“` : ei + 1}`;
    if (!isObj(e)) { add(`${w} ist kein Objekt.`); return; }
    if (!isStr(e.id)) add(`${w}: id fehlt.`);
    else if (e.id.includes('|')) add(`${w}: id darf kein „|“ enthalten.`);
    else if (exIds.has(e.id)) add(`${w}: kommt in der Einheit doppelt vor.`);
    exIds.add(e.id);
    if (!isStr(e.name)) add(`${w}: name fehlt.`);
    if (!CATEGORIES.includes(e.category)) add(`${w}: category „${e.category}“ unbekannt.`);
    if (!isPosInt(e.sets)) add(`${w}: sets muss eine positive Ganzzahl sein.`);
    const timed = e.durationSeconds != null;
    if (timed) {
      if (!isPosInt(e.durationSeconds)) add(`${w}: durationSeconds muss eine positive Ganzzahl sein.`);
    } else {
      const okMin = isNullOr(isPosInt)(e.repsMin);
      const okMax = isNullOr(isPosInt)(e.repsMax);
      if (!okMin || !okMax || (e.repsMin == null && e.repsMax == null)) add(`${w}: braucht repsMin/repsMax oder durationSeconds.`);
      else if (e.repsMin != null && e.repsMax != null && e.repsMin > e.repsMax) add(`${w}: repsMin ist größer als repsMax.`);
    }
    if (!isNullOr(isNonNegNum)(e.restSeconds)) add(`${w}: restSeconds muss eine Zahl ≥ 0 sein.`);
    if (e.perSide !== undefined && typeof e.perSide !== 'boolean') add(`${w}: perSide muss true/false sein.`);
    if (e.trackWeight !== undefined && typeof e.trackWeight !== 'boolean') add(`${w}: trackWeight muss true/false sein.`);
    if (e.groupId != null && typeof e.groupId !== 'string') add(`${w}: groupId muss Text oder null sein.`);
  });
}

// ---------------------------------------------------------------------------
// Backup

/** Validates a backup object. Returns { ok, errors, sets, tests }. */
export function validateBackup(data) {
  const { errors, add } = collector();
  if (!isObj(data)) return { ok: false, errors: ['Die Datei enthält kein JSON-Objekt.'], sets: [], tests: [] };
  if (data.app !== BACKUP_APP) add('Das ist keine Sicherung dieser App.');
  if (data.schemaVersion !== BACKUP_SCHEMA) add(`Unbekannte Version der Sicherung (${JSON.stringify(data.schemaVersion)}).`);
  if (!Array.isArray(data.sets)) add('sets fehlt.');
  if (!Array.isArray(data.tests)) add('tests fehlt.');
  if (errors.length) return { ok: false, errors, sets: [], tests: [] };

  data.sets.forEach((r, i) => {
    const w = `Satz ${i + 1}`;
    if (!isObj(r)) { add(`${w} ist kein Objekt.`); return; }
    if (!parseDate(r.date)) add(`${w}: Datum ungültig.`);
    if (!isStr(r.exerciseId)) add(`${w}: exerciseId fehlt.`);
    if (!isPosInt(r.setNo)) add(`${w}: setNo ungültig.`);
    if (r.key !== `${r.date}|${r.exerciseId}|${r.setNo}`) add(`${w}: key passt nicht zu Datum/Übung/Satz.`);
    for (const f of ['reps', 'seconds', 'weightKg']) {
      if (!isNullOr(isNonNegNum)(r[f])) add(`${w}: ${f} ungültig.`);
    }
    if (typeof r.done !== 'boolean') add(`${w}: done muss true/false sein.`);
    if (!isNonNegNum(r.updatedAt)) add(`${w}: updatedAt fehlt.`);
  });

  data.tests.forEach((r, i) => {
    const w = `Testergebnis ${i + 1}`;
    if (!isObj(r)) { add(`${w} ist kein Objekt.`); return; }
    if (!parseDate(r.date)) add(`${w}: Datum ungültig.`);
    if (!isStr(r.testId)) add(`${w}: testId fehlt.`);
    if (r.key !== `${r.date}|${r.testId}`) add(`${w}: key passt nicht zu Datum/Test.`);
    if (!Array.isArray(r.attempts) || !r.attempts.every(isNullOr(isNonNegNum))) add(`${w}: attempts ungültig.`);
    if (!isNullOr(isNonNegNum)(r.best)) add(`${w}: best ungültig.`);
    if (!isNonNegNum(r.updatedAt)) add(`${w}: updatedAt fehlt.`);
  });

  return { ok: errors.length === 0, errors, sets: data.sets, tests: data.tests };
}

export function buildBackup(sets, tests, exportedAt = new Date().toISOString()) {
  return { app: BACKUP_APP, schemaVersion: BACKUP_SCHEMA, exportedAt, sets, tests };
}

/**
 * Merge: records from `incoming` replace existing ones with the same key only
 * if they are newer (updatedAt). Returns the records to write and counts.
 */
export function mergeRecords(existing, incoming) {
  const byKey = new Map(existing.map((r) => [r.key, r]));
  const toWrite = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const rec of incoming) {
    const cur = byKey.get(rec.key);
    if (!cur) { toWrite.push(rec); added++; }
    else if ((rec.updatedAt ?? 0) > (cur.updatedAt ?? 0)) { toWrite.push(rec); updated++; }
    else skipped++;
  }
  return { toWrite, added, updated, skipped };
}

/** Small stable hash (djb2) to detect whether the bundled plan changed. */
export function fingerprint(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
