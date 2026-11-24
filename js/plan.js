// Pure plan logic. No DOM, no IndexedDB, no `new Date("yyyy-MM-dd")`.
// Dates are passed around as local "yyyy-MM-dd" strings. Day arithmetic uses
// integer day numbers computed from the date parts (DST-safe).

export const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
export const WEEKDAYS_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

export const DAY_TYPE_LABELS = {
  gym: 'Gym',
  ultimate: 'Ultimate',
  optional: 'Optional',
  rest: 'Ruhetag',
};

export const CATEGORY_LABELS = {
  jump: 'Sprung',
  strength: 'Kraft',
  core: 'Rumpf',
  prevention: 'Prävention',
  skill: 'Technik',
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

// ---------------------------------------------------------------------------
// Dates

/** Parses "yyyy-MM-dd" into {y, m, d}. Returns null for malformed or impossible dates. */
export function parseDate(str) {
  if (typeof str !== 'string') return null;
  const match = DATE_RE.exec(str);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) return null;
  // Day-of-month check via UTC (only used for validation, no local shift possible).
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > daysInMonth) return null;
  return { y, m, d };
}

export function isValidDate(str) {
  return parseDate(str) !== null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Integer day number for a "yyyy-MM-dd" string (days since 1970-01-01). */
export function dayNumber(str) {
  const p = parseDate(str);
  if (!p) throw new Error(`Invalid date: ${str}`);
  return Math.round(Date.UTC(p.y, p.m - 1, p.d) / MS_PER_DAY);
}

export function fromDayNumber(n) {
  const dt = new Date(n * MS_PER_DAY);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function addDays(str, days) {
  return fromDayNumber(dayNumber(str) + days);
}

/** b - a in days. */
export function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekday(str) {
  // 1970-01-01 was a Thursday (ISO 4).
  const n = dayNumber(str);
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/** Local "yyyy-MM-dd" for a JS Date (defaults to now). */
export function toDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** Monday of the week containing `str`. */
export function mondayOf(str) {
  return addDays(str, 1 - weekday(str));
}

/** "Mo, 30.11.2026" (or without year when `withYear` is false). */
export function formatDateDE(str, { withYear = true, longWeekday = false } = {}) {
  const p = parseDate(str);
  if (!p) return str;
  const names = longWeekday ? WEEKDAYS_LONG : WEEKDAYS_SHORT;
  const wd = names[weekday(str) - 1];
  const base = `${pad2(p.d)}.${pad2(p.m)}.`;
  return `${wd}, ${withYear ? base + p.y : base}`;
}

/** "30.11." */
export function formatShortDE(str) {
  const p = parseDate(str);
  return p ? `${pad2(p.d)}.${pad2(p.m)}.` : str;
}

// ---------------------------------------------------------------------------
// Phases and weeks

/** Phases sorted by start date. */
export function sortedPhases(plan) {
  return [...plan.phases].sort((a, b) => dayNumber(a.startDate) - dayNumber(b.startDate));
}

/** Last day of a phase, or null for open-ended phases (weeks === null). */
export function phaseEndDate(phase) {
  if (phase.weeks == null) return null;
  return addDays(phase.startDate, phase.weeks * 7 - 1);
}

export function phaseContains(phase, date) {
  const n = dayNumber(date);
  if (n < dayNumber(phase.startDate)) return false;
  const end = phaseEndDate(phase);
  return end === null || n <= dayNumber(end);
}

/** The phase that contains `date`, or null. */
export function phaseForDate(plan, date) {
  return sortedPhases(plan).find((p) => phaseContains(p, date)) ?? null;
}

/** 1-based week number of `date` within `phase`. */
export function weekInPhase(phase, date) {
  return Math.floor(daysBetween(phase.startDate, date) / 7) + 1;
}

export function isDeloadWeek(phase, weekNo) {
  return Array.isArray(phase.deloadWeeks) && phase.deloadWeeks.includes(weekNo);
}

/** First day of week `weekNo` in `phase`. */
export function weekStartDate(phase, weekNo) {
  return addDays(phase.startDate, (weekNo - 1) * 7);
}

/**
 * Week numbers to show in the plan browser. Open-ended phases show the
 * weeks up to the current one plus `lookahead` weeks (at least `minWeeks`).
 */
export function browsableWeeks(phase, today, { lookahead = 4, minWeeks = 8 } = {}) {
  let count = phase.weeks;
  if (count == null) {
    const current = dayNumber(today) >= dayNumber(phase.startDate) ? weekInPhase(phase, today) : 0;
    count = Math.max(minWeeks, current + lookahead);
  }
  return Array.from({ length: count }, (_, i) => i + 1);
}

export function findSession(phase, sessionId) {
  if (!sessionId) return null;
  return phase.sessions.find((s) => s.id === sessionId) ?? null;
}

export function scheduleEntry(phase, wd) {
  return phase.schedule.find((s) => s.weekday === wd) ?? null;
}

// ---------------------------------------------------------------------------
// Tests

export function isTestDay(plan, date) {
  return (plan.testDates ?? []).includes(date);
}

/** Next test date on or after `date`, or null. */
export function nextTestDate(plan, date) {
  const n = dayNumber(date);
  const upcoming = (plan.testDates ?? [])
    .filter((d) => dayNumber(d) >= n)
    .sort((a, b) => dayNumber(a) - dayNumber(b));
  return upcoming[0] ?? null;
}

// ---------------------------------------------------------------------------
// Day info

/**
 * Everything the UI needs to render one day.
 * status: 'before' (plan not started), 'active', 'after' (plan finished), 'gap'.
 */
export function dayInfo(plan, date) {
  const phases = sortedPhases(plan);
  const base = {
    date,
    weekday: weekday(date),
    isTestDay: isTestDay(plan, date),
    nextTestDate: nextTestDate(plan, date),
    phase: null,
    weekNo: null,
    totalWeeks: null,
    isDeload: false,
    entry: null,
    session: null,
  };
  if (phases.length === 0) return { ...base, status: 'gap' };

  const phase = phases.find((p) => phaseContains(p, date));
  if (!phase) {
    const n = dayNumber(date);
    if (n < dayNumber(phases[0].startDate)) {
      return { ...base, status: 'before', startsIn: daysBetween(date, phases[0].startDate), firstPhase: phases[0] };
    }
    const last = phases[phases.length - 1];
    const lastEnd = phaseEndDate(last);
    if (lastEnd !== null && n > dayNumber(lastEnd)) return { ...base, status: 'after' };
    return { ...base, status: 'gap' };
  }

  const weekNo = weekInPhase(phase, date);
  const entry = scheduleEntry(phase, base.weekday);
  return {
    ...base,
    status: 'active',
    phase,
    weekNo,
    totalWeeks: phase.weeks,
    isDeload: isDeloadWeek(phase, weekNo),
    entry,
    session: entry ? findSession(phase, entry.sessionId) : null,
  };
}

/** "Woche 3 von 6" or "Woche 3" for open-ended phases. */
export function weekLabel(weekNo, totalWeeks) {
  return totalWeeks == null ? `Woche ${weekNo}` : `Woche ${weekNo} von ${totalWeeks}`;
}

// ---------------------------------------------------------------------------
// Prescriptions

/** Planned sets, reduced in deload weeks: max(1, round(sets × factor)), half rounds up. */
export function plannedSets(exercise, isDeload, setsFactor = 1) {
  if (!isDeload) return exercise.sets;
  return Math.max(1, Math.round(exercise.sets * setsFactor));
}

export function setsFactorOf(plan) {
  return plan?.deload?.setsFactor ?? 1;
}

/** True if the exercise is prescribed by time rather than reps. */
export function isTimed(exercise) {
  return exercise.durationSeconds != null;
}

/** "6–8", "5", or "20 s" (without set count and side suffix). */
export function targetText(exercise) {
  if (isTimed(exercise)) return `${exercise.durationSeconds} s`;
  const { repsMin, repsMax } = exercise;
  if (repsMin == null && repsMax == null) return '';
  if (repsMin == null || repsMax == null || repsMin === repsMax) return String(repsMin ?? repsMax);
  return `${repsMin}–${repsMax}`;
}

/** "4 × 6–8", "3 × 20 s pro Seite", "3 × 8 pro Seite". */
export function prescriptionText(exercise, sets = exercise.sets) {
  const target = targetText(exercise);
  let text = target ? `${sets} × ${target}` : `${sets} Sätze`;
  if (exercise.perSide) text += ' pro Seite';
  return text;
}

/** "90 s", "2 min", "2:30 min". */
export function formatRest(seconds) {
  if (seconds == null) return '';
  if (seconds < 120 && seconds % 60 !== 0) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m} min` : `${m}:${pad2(s)} min`;
}

/** "1:05" countdown display (rounded up to whole seconds). */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

/**
 * Groups consecutive exercises with the same non-null groupId into one block.
 * Returns [{ groupId, exercises: [...] }]. Single exercises have groupId null.
 */
export function groupExercises(exercises) {
  const blocks = [];
  for (const ex of exercises) {
    const last = blocks[blocks.length - 1];
    if (ex.groupId && last && last.groupId === ex.groupId) {
      last.exercises.push(ex);
    } else {
      blocks.push({ groupId: ex.groupId ?? null, exercises: [ex] });
    }
  }
  return blocks;
}

/**
 * Order in which sets of a block are done: for contrast pairs, sets alternate
 * (A1, B1, A2, B2, …); single exercises are sequential.
 * Returns [{ exercise, setNo }] with 1-based setNo.
 */
export function blockSetOrder(block, isDeload, setsFactor) {
  const counts = block.exercises.map((ex) => plannedSets(ex, isDeload, setsFactor));
  const maxSets = Math.max(...counts);
  const order = [];
  for (let setNo = 1; setNo <= maxSets; setNo++) {
    block.exercises.forEach((ex, i) => {
      if (setNo <= counts[i]) order.push({ exercise: ex, setNo });
    });
  }
  return order;
}

// ---------------------------------------------------------------------------
// Exercise catalogue

/**
 * All exercises by id across the plan. The name/meta come from the latest
 * phase that contains the exercise. Returns Map<id, {id, name, category,
 * trackWeight, timed, phaseIds}>.
 */
export function exerciseCatalog(plan) {
  const map = new Map();
  for (const phase of sortedPhases(plan)) {
    for (const session of phase.sessions) {
      for (const ex of session.exercises) {
        const prev = map.get(ex.id);
        const phaseIds = prev ? prev.phaseIds : [];
        if (!phaseIds.includes(phase.id)) phaseIds.push(phase.id);
        map.set(ex.id, {
          id: ex.id,
          name: ex.name,
          category: ex.category,
          trackWeight: Boolean(ex.trackWeight) || Boolean(prev?.trackWeight),
          timed: isTimed(ex),
          phaseIds,
        });
      }
    }
  }
  return map;
}
