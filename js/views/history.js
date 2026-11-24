// Exercise history: list of exercises, and per exercise the top set per
// session as chart + list.

import { exerciseCatalog, formatDateDE, CATEGORY_LABELS } from '../plan.js';
import { el } from '../ui.js';
import { formatDecimal, formatSet } from '../util.js';
import { topSetsByDate } from '../stats.js';
import { renderChart } from '../svgchart.js';
import * as db from '../db.js';
import * as logs from '../logs.js';

const CATEGORY_ORDER = ['jump', 'strength', 'core', 'prevention', 'skill'];

export async function renderHistory(ctx, exerciseId) {
  return exerciseId ? detail(ctx, exerciseId) : overview(ctx);
}

async function overview(ctx) {
  const catalog = exerciseCatalog(ctx.plan);
  const byEx = new Map();
  for (const r of await db.getAll('sets')) {
    if (!byEx.has(r.exerciseId)) byEx.set(r.exerciseId, []);
    byEx.get(r.exerciseId).push(r);
  }

  // Logged exercises that are no longer in the plan.
  const orphans = [...byEx.keys()].filter((id) => !catalog.has(id));

  const root = el('div', { class: 'history' },
    el('h1', { text: 'Verlauf' }),
    el('p', { class: 'muted', text: 'Bester Satz pro Einheit für jede Übung.' }));

  for (const cat of CATEGORY_ORDER) {
    const items = [...catalog.values()].filter((e) => e.category === cat);
    if (items.length === 0) continue;
    // Exercises with logs first, then alphabetical.
    items.sort((a, b) => (byEx.has(b.id) - byEx.has(a.id)) || a.name.localeCompare(b.name, 'de'));
    root.append(el('h2', { class: 'section-title', text: CATEGORY_LABELS[cat] }),
      el('div', { class: 'list-card card' }, items.map((e) => exerciseRow(e.id, e.name, e.trackWeight, byEx.get(e.id)))));
  }
  if (orphans.length) {
    root.append(el('h2', { class: 'section-title', text: 'Nicht mehr im Plan' }),
      el('div', { class: 'list-card card' }, orphans.map((id) => {
        const recs = byEx.get(id);
        return exerciseRow(id, recs.at(-1).exerciseName ?? id, recs.some((r) => r.weightKg != null), recs);
      })));
  }
  return root;
}

function exerciseRow(id, name, trackWeight, records) {
  let summary = 'Noch keine Einträge';
  if (records?.length) {
    const sessions = topSetsByDate(records, { trackWeight });
    const last = sessions.at(-1);
    summary = `${sessions.length} ${sessions.length === 1 ? 'Einheit' : 'Einheiten'}`;
    if (last.top) summary += ` · zuletzt ${formatSet(last.top)}`;
  }
  return el('a', { class: `list-row${records?.length ? '' : ' empty'}`, href: `#/verlauf/${encodeURIComponent(id)}` },
    el('div', {}, el('div', { class: 'list-row-title', text: name }), el('div', { class: 'muted small', text: summary })),
    el('span', { class: 'chevron', 'aria-hidden': 'true', text: '›' }));
}

async function detail(ctx, exerciseId) {
  const catalog = exerciseCatalog(ctx.plan);
  const records = await logs.setsForExercise(exerciseId);
  const info = catalog.get(exerciseId);
  const trackWeight = info ? info.trackWeight : records.some((r) => r.weightKg != null);
  const timed = info ? info.timed : records.some((r) => r.seconds != null);
  const name = info?.name ?? records.at(-1)?.exerciseName ?? exerciseId;
  const unit = trackWeight ? 'kg' : timed ? 's' : 'Wdh.';

  const sessions = topSetsByDate(records, { trackWeight });
  const withValue = sessions.filter((s) => s.value != null);
  const best = withValue.length ? Math.max(...withValue.map((s) => s.value)) : null;

  const root = el('div', { class: 'history' },
    el('a', { class: 'back-link', href: '#/verlauf', text: '‹ Verlauf' }),
    el('h1', { text: name }),
    info && el('p', { class: 'muted', text: CATEGORY_LABELS[info.category] ?? info.category }));

  if (sessions.length === 0) {
    root.append(el('section', { class: 'card' }, el('p', { text: 'Für diese Übung gibt es noch keine Einträge.' })));
    return root;
  }

  root.append(el('section', { class: 'card chart-card' },
    el('div', { class: 'test-title' },
      el('h3', { text: trackWeight ? 'Schwerster Satz' : timed ? 'Längster Satz' : 'Meiste Wiederholungen' }),
      best != null && el('span', { class: 'muted', text: `Bestwert ${formatDecimal(best)} ${unit}` })),
    renderChart(withValue.map((s) => ({ date: s.date, value: s.value })), { unit })));

  root.append(el('section', { class: 'card' },
    el('h3', { text: 'Einheiten' }),
    el('ul', { class: 'plain-list' }, [...sessions].reverse().map((s) => el('li', { class: 'session-row' },
      el('a', { href: `#/tag/${s.date}`, text: formatDateDE(s.date) }),
      el('div', {},
        s.top && el('strong', { text: formatSet(s.top) }),
        el('div', { class: 'muted small', text: s.sets.map(formatSet).join(' · ') })))))));
  return root;
}
