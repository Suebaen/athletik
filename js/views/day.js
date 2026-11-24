// Day view: header (phase, week, deload, tests) + session with set logging.
// Used for "Heute" and for any date opened from the plan browser.

import {
  dayInfo, groupExercises, plannedSets, setsFactorOf, prescriptionText, formatRest,
  weekLabel, formatDateDE, addDays, daysBetween, isTimed, exerciseCatalog,
  DAY_TYPE_LABELS, CATEGORY_LABELS,
} from '../plan.js';
import { el } from '../ui.js';
import { parseDecimal, parseIntOrNull, formatDecimal, formatSet } from '../util.js';
import * as logs from '../logs.js';

const DEFAULT_NOTES = {
  rest: 'Erholung.',
  optional: 'Optionaler Tag.',
  ultimate: 'Ultimate-Training.',
  gym: '',
};

export async function renderDay(ctx, date, { isToday = false } = {}) {
  const plan = ctx.plan;
  const info = dayInfo(plan, date);
  const dayLogs = await logs.setsForDate(date);

  const root = el('div', { class: 'day' });
  root.append(dayHeader(info, isToday, ctx));
  root.append(...statusBanners(plan, info, isToday));

  if (info.status === 'active' && info.entry) {
    if (info.session) {
      root.append(await sessionView(ctx, info, dayLogs));
    } else {
      root.append(restCard(info));
    }
  }

  const other = otherEntries(plan, info, dayLogs);
  if (other) root.append(other);
  return root;
}

// ---------------------------------------------------------------------------
// Header

function dayHeader(info, isToday, ctx) {
  const title = isToday ? 'Heute' : formatDateDE(info.date, { longWeekday: true, withYear: false });
  const sub = isToday
    ? formatDateDE(info.date, { longWeekday: true })
    : relativeDayText(daysBetween(ctx.today(), info.date)) ?? info.date.slice(0, 4);

  const header = el('header', { class: 'day-header' },
    el('div', { class: 'day-nav' },
      el('a', { class: 'icon-btn', href: `#/tag/${addDays(info.date, -1)}`, 'aria-label': 'Vorheriger Tag', text: '‹' }),
      el('div', { class: 'day-title' },
        el('h1', { text: title }),
        el('div', { class: 'muted', text: sub })),
      el('a', { class: 'icon-btn', href: `#/tag/${addDays(info.date, 1)}`, 'aria-label': 'Nächster Tag', text: '›' })),
  );

  if (info.status === 'active') {
    const { phase } = info;
    header.append(
      el('div', { class: 'phase-line' },
        el('span', { class: 'phase-name', text: phase.order != null ? `Phase ${phase.order} · ${phase.name}` : phase.name }),
        el('span', { class: 'week', text: weekLabel(info.weekNo, info.totalWeeks) }),
        info.isDeload && el('span', { class: 'badge badge-deload', text: 'Deload' })),
      phase.focus && el('p', { class: 'phase-focus', text: phase.focus }),
    );
    if (info.isDeload && ctx.plan.deload?.description) {
      header.append(el('p', { class: 'deload-note', text: ctx.plan.deload.description }));
    }
  }
  if (!isToday && info.date !== ctx.today()) {
    header.append(el('a', { class: 'link-today', href: '#/heute', text: 'Zu heute' }));
  }
  return header;
}

function relativeDayText(diff) {
  if (diff === 0) return 'Heute';
  if (diff === -1) return 'Gestern';
  if (diff === 1) return 'Morgen';
  if (diff < 0) return `vor ${-diff} Tagen`;
  return `in ${diff} Tagen`;
}

function statusBanners(plan, info, isToday) {
  const out = [];
  if (info.status === 'before') {
    const first = info.firstPhase;
    out.push(el('section', { class: 'card banner-info' },
      el('h2', { text: `Der Plan startet am ${formatDateDE(first.startDate)}` }),
      el('p', { text: info.startsIn === 1 ? 'Morgen geht es los.' : `Noch ${info.startsIn} Tage.` }),
      el('p', { class: 'muted', text: `Erste Phase: ${first.name}. ${first.focus ?? ''}` }),
      el('a', { class: 'btn', href: `#/tag/${first.startDate}`, text: 'Ersten Trainingstag ansehen' })));
  } else if (info.status === 'after') {
    out.push(el('section', { class: 'card banner-info' }, el('h2', { text: 'Der Plan ist abgeschlossen.' })));
  } else if (info.status === 'gap') {
    out.push(el('section', { class: 'card banner-info' }, el('p', { text: 'Für diesen Tag ist keine Phase geplant.' })));
  }

  if (info.isTestDay) {
    const names = (plan.tests ?? []).map((t) => t.name).join(', ');
    out.push(el('a', { class: 'card banner-test', href: `#/tests/${info.date}` },
      el('strong', { text: isToday ? 'Heute ist Testtag' : 'Testtag' }),
      el('span', { text: names }),
      el('span', { class: 'banner-cta', text: 'Ergebnisse eintragen ›' })));
  } else if (isToday && info.nextTestDate) {
    const inDays = daysBetween(info.date, info.nextTestDate);
    if (inDays <= 7) {
      out.push(el('a', { class: 'card banner-soft', href: '#/tests' },
        `Nächster Test: ${formatDateDE(info.nextTestDate, { withYear: false })} (${relativeDayText(inDays)})`));
    }
  }
  return out;
}

function typeChip(type) {
  return el('span', { class: `chip type-${type}`, text: DAY_TYPE_LABELS[type] ?? type });
}

function restCard(info) {
  const { entry } = info;
  return el('section', { class: `card day-card type-${entry.type}` },
    typeChip(entry.type),
    el('p', { class: 'day-note', text: entry.note ?? DEFAULT_NOTES[entry.type] ?? '' }));
}

// ---------------------------------------------------------------------------
// Session

async function sessionView(ctx, info, dayLogs) {
  const { session, entry, phase } = info;
  const factor = setsFactorOf(ctx.plan);
  const blocks = groupExercises(session.exercises);

  // Last weights for prefill, fetched in parallel.
  const weighted = session.exercises.filter((e) => e.trackWeight);
  const lastWeights = new Map(await Promise.all(
    weighted.map(async (e) => [e.id, await logs.lastWeight(e.id, info.date)])));

  const progress = el('span', { class: 'progress' });
  const wrap = el('div', { class: 'session' },
    el('section', { class: `card session-head type-${entry.type}` },
      el('div', { class: 'session-head-top' }, typeChip(entry.type), progress),
      el('h2', { text: session.name }),
      session.focus && el('p', { class: 'muted', text: session.focus }),
      entry.note && el('p', { class: 'day-note', text: entry.note })));

  const sessionCtx = {
    ctx, date: info.date, phaseId: phase.id, sessionId: session.id,
    isDeload: info.isDeload, factor, dayLogs, lastWeights,
    rowsByExercise: new Map(),
    updateProgress: () => {
      const boxes = wrap.querySelectorAll('.set-row input[type=checkbox]');
      const done = [...boxes].filter((b) => b.checked).length;
      progress.textContent = `${done} / ${boxes.length} Sätze`;
      const complete = boxes.length > 0 && done === boxes.length;
      progress.classList.toggle('complete', complete);
      return complete;
    },
  };

  for (const block of blocks) {
    wrap.append(block.groupId && block.exercises.length > 1
      ? pairView(sessionCtx, block)
      : exerciseView(sessionCtx, block.exercises[0]));
  }
  sessionCtx.updateProgress();
  return wrap;
}

/** Number of rows to show: planned sets, or more if more were logged. */
function rowCount(sc, exercise) {
  const planned = plannedSets(exercise, sc.isDeload, sc.factor);
  let maxLogged = 0;
  for (const r of sc.dayLogs.values()) {
    if (r.exerciseId === exercise.id) maxLogged = Math.max(maxLogged, r.setNo);
  }
  return Math.max(planned, maxLogged);
}

function exerciseHead(sc, exercise, { compact = false } = {}) {
  const sets = plannedSets(exercise, sc.isDeload, sc.factor);
  return el('div', { class: compact ? 'ex-head compact' : 'ex-head' },
    el('div', { class: 'ex-title' },
      el('h3', { text: exercise.name }),
      el('span', { class: `chip cat-${exercise.category}`, text: CATEGORY_LABELS[exercise.category] ?? exercise.category })),
    el('div', { class: 'rx' },
      el('strong', { text: prescriptionText(exercise, sets) }),
      exercise.restSeconds != null && el('span', { class: 'muted', text: ` · Pause ${formatRest(exercise.restSeconds)}` })),
    exercise.notes && el('p', { class: 'ex-notes', text: exercise.notes }));
}

function exerciseView(sc, exercise) {
  const rowsBox = el('div', { class: 'sets' });
  const count = rowCount(sc, exercise);
  for (let setNo = 1; setNo <= count; setNo++) {
    rowsBox.append(setRow(sc, exercise, setNo, String(setNo)));
  }
  const addBtn = el('button', {
    class: 'btn-text add-set', type: 'button', text: '+ Satz',
    onclick: () => {
      const rows = sc.rowsByExercise.get(exercise.id) ?? [];
      rowsBox.append(setRow(sc, exercise, rows.length + 1, String(rows.length + 1)));
      sc.updateProgress();
    },
  });
  return el('section', { class: `card exercise cat-${exercise.category}` },
    exerciseHead(sc, exercise), rowsBox, addBtn);
}

function pairView(sc, block) {
  const rowsBox = el('div', { class: 'sets' });
  const counts = block.exercises.map((ex) => rowCount(sc, ex));
  const maxSets = Math.max(...counts);
  for (let setNo = 1; setNo <= maxSets; setNo++) {
    block.exercises.forEach((ex, i) => {
      if (setNo <= counts[i]) rowsBox.append(setRow(sc, ex, setNo, `${shortName(ex.name)} ${setNo}`, true));
    });
  }
  return el('section', { class: 'card pair' },
    el('div', { class: 'pair-label', text: 'Kontrastpaar · abwechselnd, direkt hintereinander' }),
    block.exercises.map((ex) => exerciseHead(sc, ex, { compact: true })),
    rowsBox);
}

/** "Box Jumps (Kontrastpaar)" → "Box Jumps". */
function shortName(name) {
  return name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Set row

function setRow(sc, exercise, setNo, label, wide = false) {
  const key = logs.setKey(sc.date, exercise.id, setNo);
  const rec = sc.dayLogs.get(key);
  const timed = isTimed(exercise);
  const rows = sc.rowsByExercise.get(exercise.id) ?? [];
  sc.rowsByExercise.set(exercise.id, rows);

  const amountInput = el('input', {
    type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', enterkeyhint: 'done',
    class: 'in-amount',
    placeholder: timed ? String(exercise.durationSeconds) : targetPlaceholder(exercise),
    'aria-label': timed ? 'Sekunden' : 'Wiederholungen',
    value: rec ? String((timed ? rec.seconds : rec.reps) ?? '') : '',
  });

  let weightInput = null;
  if (exercise.trackWeight) {
    let value = '';
    let prefilled = false;
    if (rec?.weightKg != null) {
      value = formatDecimal(rec.weightKg);
    } else {
      const fromSession = previousRowWeight(rows);
      const prefill = fromSession ?? sc.lastWeights.get(exercise.id) ?? null;
      if (prefill != null) { value = formatDecimal(prefill); prefilled = true; }
    }
    weightInput = el('input', {
      type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
      class: prefilled ? 'in-weight prefilled' : 'in-weight', placeholder: 'kg', 'aria-label': 'Gewicht in kg', value,
    });
  }

  const check = el('input', { type: 'checkbox', checked: Boolean(rec?.done), 'aria-label': `Satz ${setNo} erledigt` });

  const row = el('div', { class: `set-row${wide ? ' wide' : ''}${rec?.done ? ' done' : ''}` },
    el('span', { class: 'set-label', text: label }),
    el('label', { class: 'field' }, amountInput, el('span', { class: 'unit', text: timed ? 's' : 'Wdh.' })),
    weightInput
      ? el('label', { class: 'field' }, weightInput, el('span', { class: 'unit', text: 'kg' }))
      : el('span', { class: 'field-empty' }),
    el('label', { class: 'check' }, check, el('span', { class: 'check-box', 'aria-hidden': 'true' })));

  const rowState = { setNo, weightInput, hasRecord: Boolean(rec) };
  rows.push(rowState);

  const save = async () => {
    const amount = parseIntOrNull(amountInput.value);
    const weightKg = weightInput ? parseDecimal(weightInput.value) : null;
    const done = check.checked;
    row.classList.toggle('done', done);
    amountInput.classList.toggle('invalid', amountInput.value.trim() !== '' && amount == null);
    weightInput?.classList.toggle('invalid', weightInput.value.trim() !== '' && weightKg == null);

    if (amount == null && weightKg == null && !done) {
      rowState.hasRecord = false;
      await logs.deleteSet(key);
      return;
    }
    rowState.hasRecord = true;
    await logs.saveSet({
      key, date: sc.date, exerciseId: exercise.id, setNo,
      exerciseName: exercise.name, phaseId: sc.phaseId, sessionId: sc.sessionId,
      reps: timed ? null : amount,
      seconds: timed ? amount : null,
      weightKg, done,
    });
  };
  const saveSafely = () => save().catch((err) => {
    console.error(err);
    sc.ctx.toast?.('Speichern fehlgeschlagen');
  });

  amountInput.addEventListener('input', saveSafely);
  weightInput?.addEventListener('input', () => {
    weightInput.classList.remove('prefilled');
    propagateWeight(rows, rowState, weightInput.value);
    saveSafely();
  });
  check.addEventListener('change', () => {
    if (check.checked) {
      if (amountInput.value.trim() === '') {
        const def = timed ? exercise.durationSeconds : (exercise.repsMax ?? exercise.repsMin);
        if (def != null) amountInput.value = String(def);
      }
      weightInput?.classList.remove('prefilled');
    }
    saveSafely();
    const sessionComplete = sc.updateProgress();
    // Rest timer only for live workouts, not when back-filling another day.
    if (check.checked && sc.date === sc.ctx.today()) {
      sc.ctx.onSetDone?.({ exercise, setNo, date: sc.date, sessionComplete });
    }
  });

  return row;
}

function targetPlaceholder(exercise) {
  const { repsMin, repsMax } = exercise;
  if (repsMin == null && repsMax == null) return '';
  if (repsMin === repsMax || repsMin == null || repsMax == null) return String(repsMin ?? repsMax);
  return `${repsMin}–${repsMax}`;
}

/** Weight of the last earlier row in this session that has a value. */
function previousRowWeight(rows) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].weightInput ? parseDecimal(rows[i].weightInput.value) : null;
    if (v != null) return v;
  }
  return null;
}

/** Typing a weight updates later rows that only show a prefilled value. */
function propagateWeight(rows, fromRow, value) {
  for (const r of rows) {
    if (r.setNo <= fromRow.setNo || r.hasRecord || !r.weightInput) continue;
    if (!r.weightInput.classList.contains('prefilled')) continue;
    r.weightInput.value = value;
  }
}

// ---------------------------------------------------------------------------
// Logs that don't belong to today's session (e.g. after a plan update)

function otherEntries(plan, info, dayLogs) {
  const inSession = new Set((info.session?.exercises ?? []).map((e) => e.id));
  const extra = [...dayLogs.values()].filter((r) => !inSession.has(r.exerciseId));
  if (extra.length === 0) return null;
  const catalog = exerciseCatalog(plan);
  const byEx = new Map();
  for (const r of extra.sort((a, b) => a.setNo - b.setNo)) {
    if (!byEx.has(r.exerciseId)) byEx.set(r.exerciseId, []);
    byEx.get(r.exerciseId).push(r);
  }
  return el('section', { class: 'card' },
    el('h3', { text: 'Weitere Einträge an diesem Tag' }),
    el('ul', { class: 'plain-list' },
      [...byEx].map(([id, recs]) => el('li', {},
        el('strong', { text: catalog.get(id)?.name ?? recs[0].exerciseName ?? id }),
        el('span', { class: 'muted', text: ` – ${recs.map(formatSet).join(', ')}` })))));
}
