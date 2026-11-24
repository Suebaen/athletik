// Plan browser: phases → weeks → days. Days link to the day view (#/tag/…),
// where past days can be logged too.

import {
  sortedPhases, phaseEndDate, phaseContains, browsableWeeks, weekStartDate, isDeloadWeek,
  addDays, scheduleEntry, findSession, plannedSets, setsFactorOf, weekLabel, weekInPhase,
  isTestDay, formatDateDE, formatShortDE, dayNumber, DAY_TYPE_LABELS, WEEKDAYS_SHORT,
} from '../plan.js';
import { el } from '../ui.js';
import * as db from '../db.js';

export async function renderPlan(ctx, phaseId, weekStr) {
  const plan = ctx.plan;
  const doneByDate = await doneSetsByDate();
  if (!phaseId) return phaseList(ctx);
  const phase = plan.phases.find((p) => p.id === phaseId);
  if (!phase) return notFound('Diese Phase gibt es im aktuellen Plan nicht.');
  if (!weekStr) return weekList(ctx, phase, doneByDate);
  const weekNo = Number(weekStr);
  if (!Number.isInteger(weekNo) || weekNo < 1 || (phase.weeks != null && weekNo > phase.weeks)) {
    return notFound('Diese Woche gibt es in der Phase nicht.');
  }
  return weekView(ctx, phase, weekNo, doneByDate);
}

async function doneSetsByDate() {
  const map = new Map();
  for (const r of await db.getAll('sets')) {
    if (r.done) map.set(r.date, (map.get(r.date) ?? 0) + 1);
  }
  return map;
}

function notFound(text) {
  return el('section', { class: 'card' }, el('p', { text }), el('a', { class: 'btn', href: '#/plan', text: 'Zur Übersicht' }));
}

function backLink(href, text) {
  return el('a', { class: 'back-link', href, text: `‹ ${text}` });
}

/** "30.11.2026" */
const numericDate = (d) => `${formatShortDE(d)}${d.slice(0, 4)}`;

function dateRange(from, to) {
  return to ? `${numericDate(from)} – ${numericDate(to)}` : `ab ${numericDate(from)}`;
}

function sessionSetCount(session, isDeload, factor) {
  return session ? session.exercises.reduce((n, e) => n + plannedSets(e, isDeload, factor), 0) : 0;
}

// ---------------------------------------------------------------------------

function phaseList(ctx) {
  const plan = ctx.plan;
  const today = ctx.today();
  const root = el('div', { class: 'plan' },
    el('h1', { text: 'Plan' }),
    el('p', { class: 'muted', text: plan.title }),
    plan.goal && el('p', { class: 'goal-line', text: `Ziel: ${plan.goal.description ?? ''}` }));

  for (const phase of sortedPhases(plan)) {
    const end = phaseEndDate(phase);
    const current = phaseContains(phase, today);
    const past = end !== null && dayNumber(end) < dayNumber(today);
    const deload = phase.deloadWeeks?.length ? `Deload: Woche ${phase.deloadWeeks.join(' + ')}` : null;
    root.append(el('a', { class: `card nav-card${current ? ' current' : ''}${past ? ' past' : ''}`, href: `#/plan/${phase.id}` },
      el('div', { class: 'nav-card-top' },
        el('h2', { text: phase.order != null ? `Phase ${phase.order} · ${phase.name}` : phase.name }),
        current && el('span', { class: 'badge badge-current', text: 'Aktuell' })),
      el('div', { class: 'muted', text: [dateRange(phase.startDate, end), phase.weeks ? `${phase.weeks} Wochen` : 'offen (Saison)', deload].filter(Boolean).join(' · ') }),
      phase.focus && el('p', { text: phase.focus }),
      el('span', { class: 'chevron', 'aria-hidden': 'true', text: '›' })));
  }

  if (plan.testDates?.length) {
    root.append(el('section', { class: 'card' },
      el('h3', { text: 'Testtermine' }),
      el('ul', { class: 'plain-list' }, [...plan.testDates].sort().map((d) => el('li', {},
        el('a', { href: `#/tag/${d}`, text: formatDateDE(d) }),
        dayNumber(d) < dayNumber(today) && el('span', { class: 'muted', text: ' · vorbei' }),
        d === today && el('span', { class: 'badge badge-test', text: 'Heute' }))))));
  }

  if (plan.rules?.length) {
    root.append(el('section', { class: 'card' },
      el('h3', { text: 'Regeln' }),
      el('ul', { class: 'rules' }, plan.rules.map((r) => el('li', { text: r })))));
  }
  return root;
}

function weekList(ctx, phase, doneByDate) {
  const today = ctx.today();
  const factor = setsFactorOf(ctx.plan);
  const current = phaseContains(phase, today) ? weekInPhase(phase, today) : null;

  const root = el('div', { class: 'plan' },
    backLink('#/plan', 'Plan'),
    el('h1', { text: phase.name }),
    el('p', { class: 'muted', text: dateRange(phase.startDate, phaseEndDate(phase)) }),
    phase.focus && el('p', { text: phase.focus }));

  const list = el('div', { class: 'week-list' });
  for (const weekNo of browsableWeeks(phase, today)) {
    const start = weekStartDate(phase, weekNo);
    const end = addDays(start, 6);
    const deload = isDeloadWeek(phase, weekNo);
    let planned = 0;
    let done = 0;
    let hasTest = false;
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i);
      const entry = scheduleEntry(phase, i + 1);
      planned += sessionSetCount(findSession(phase, entry?.sessionId), deload, factor);
      done += doneByDate.get(date) ?? 0;
      hasTest ||= isTestDay(ctx.plan, date);
    }
    list.append(el('a', { class: `card nav-card week-card${weekNo === current ? ' current' : ''}`, href: `#/plan/${phase.id}/${weekNo}` },
      el('div', { class: 'nav-card-top' },
        el('strong', { text: weekLabel(weekNo, phase.weeks) }),
        el('span', { class: 'badges' },
          weekNo === current && el('span', { class: 'badge badge-current', text: 'Aktuell' }),
          deload && el('span', { class: 'badge badge-deload', text: 'Deload' }),
          hasTest && el('span', { class: 'badge badge-test', text: 'Test' }))),
      el('div', { class: 'muted', text: `${formatShortDE(start)} – ${formatShortDE(end)}${done ? ` · ${done}/${planned} Sätze` : ''}` }),
      el('span', { class: 'chevron', 'aria-hidden': 'true', text: '›' })));
  }
  root.append(list);
  return root;
}

function weekView(ctx, phase, weekNo, doneByDate) {
  const today = ctx.today();
  const factor = setsFactorOf(ctx.plan);
  const deload = isDeloadWeek(phase, weekNo);
  const start = weekStartDate(phase, weekNo);
  const hasPrev = weekNo > 1;
  const hasNext = phase.weeks == null || weekNo < phase.weeks;

  const root = el('div', { class: 'plan' },
    backLink(`#/plan/${phase.id}`, phase.name),
    el('div', { class: 'day-nav' },
      hasPrev ? el('a', { class: 'icon-btn', href: `#/plan/${phase.id}/${weekNo - 1}`, 'aria-label': 'Vorherige Woche', text: '‹' }) : el('span', { class: 'icon-spacer' }),
      el('div', { class: 'day-title' },
        el('h1', { text: weekLabel(weekNo, phase.weeks) }),
        el('div', { class: 'muted', text: `${formatShortDE(start)} – ${formatShortDE(addDays(start, 6))}` })),
      hasNext ? el('a', { class: 'icon-btn', href: `#/plan/${phase.id}/${weekNo + 1}`, 'aria-label': 'Nächste Woche', text: '›' }) : el('span', { class: 'icon-spacer' })),
    deload && el('p', { class: 'deload-note', text: `Deload-Woche. ${ctx.plan.deload?.description ?? ''}` }));

  const list = el('div', { class: 'day-list' });
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const entry = scheduleEntry(phase, i + 1);
    const session = findSession(phase, entry?.sessionId);
    const planned = sessionSetCount(session, deload, factor);
    const done = doneByDate.get(date) ?? 0;
    const type = entry?.type ?? 'rest';
    const title = session?.name ?? entry?.note ?? DAY_TYPE_LABELS[type] ?? '';
    const isPast = dayNumber(date) < dayNumber(today);

    let status = null;
    if (planned && done >= planned) status = el('span', { class: 'status done', text: '✓' });
    else if (done) status = el('span', { class: 'status partial', text: `${done}/${planned || done}` });
    else if (planned && isPast) status = el('span', { class: 'status missed', text: '–' });

    list.append(el('a', { class: `day-row type-${type}${date === today ? ' today' : ''}`, href: `#/tag/${date}` },
      el('div', { class: 'day-row-date' },
        el('strong', { text: WEEKDAYS_SHORT[i] }),
        el('span', { class: 'muted', text: formatShortDE(date) })),
      el('div', { class: 'day-row-main' },
        el('div', { class: 'day-row-chips' },
          el('span', { class: `chip type-${type}`, text: DAY_TYPE_LABELS[type] ?? type }),
          isTestDay(ctx.plan, date) && el('span', { class: 'badge badge-test', text: 'Test' })),
        el('div', { class: 'day-row-title', text: title })),
      status));
  }
  root.append(list);
  return root;
}
