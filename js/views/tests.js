// Performance tests: enter attempts per test and date, see progress charts.

import { formatDateDE, formatShortDE, isTestDay, isValidDate, nextTestDate, daysBetween } from '../plan.js';
import { el } from '../ui.js';
import { parseDecimal, formatDecimal } from '../util.js';
import { bestAttempt, testSeries } from '../stats.js';
import { renderChart } from '../svgchart.js';
import * as db from '../db.js';

let selectedDate = null; // kept while the app is open

export async function renderTests(ctx, dateParam) {
  if (dateParam && isValidDate(dateParam)) selectedDate = dateParam;
  const plan = ctx.plan;
  const tests = plan.tests ?? [];
  const today = ctx.today();
  if (!selectedDate || !isValidDate(selectedDate)) selectedDate = today;

  const records = await db.getAll('tests');
  const byKey = new Map(records.map((r) => [r.key, r]));

  const root = el('div', { class: 'tests' }, el('h1', { text: 'Tests' }));
  if (tests.length === 0) {
    root.append(el('p', { class: 'card', text: 'Der Plan enthält keine Tests.' }));
    return root;
  }

  const goalBox = el('div');
  const charts = el('div');
  const refresh = async () => {
    const all = await db.getAll('tests');
    goalBox.replaceChildren(goalCard(plan, all));
    charts.replaceChildren(...tests.map((t) => chartCard(ctx, t, all)));
  };

  root.append(goalBox, dateCard(ctx, records, today), entryCard(ctx, tests, byKey, refresh), charts);
  await refresh();
  return root;
}

function goalCard(plan, records) {
  const goal = plan.goal;
  if (!goal) return el('span');
  const test = plan.tests.find((t) => t.id === goal.testId);
  const series = testSeries(records, goal.testId);
  const best = series.length ? Math.max(...series.map((s) => s.best)) : null;
  const unit = goal.unit ?? test?.unit ?? '';
  const pct = best != null ? Math.min(100, Math.round((best / goal.target) * 100)) : 0;
  return el('section', { class: 'card goal-card' },
    el('div', { class: 'goal-top' },
      el('span', { class: 'muted', text: `Ziel ${test?.name ?? goal.testId}` }),
      el('strong', { text: `${formatDecimal(goal.target)} ${unit}` })),
    el('div', { class: 'goal-value', text: best != null ? `${formatDecimal(best)} ${unit}` : '–' }),
    el('div', { class: 'goal-bar' }, el('span', { style: `width:${pct}%` })),
    el('p', { class: 'muted', text: best == null
      ? 'Noch kein Ergebnis.'
      : best >= goal.target ? 'Ziel erreicht!' : `Noch ${formatDecimal(Math.round((goal.target - best) * 10) / 10)} ${unit} bis zum Ziel.` }));
}

function dateCard(ctx, records, today) {
  const plan = ctx.plan;
  const withResults = new Set(records.filter((r) => r.best != null).map((r) => r.date));
  const dates = [...new Set([...(plan.testDates ?? []), today])].sort();

  const input = el('input', {
    type: 'date', value: selectedDate, class: 'date-input', 'aria-label': 'Testdatum',
    onchange: () => { if (isValidDate(input.value)) location.hash = `#/tests/${input.value}`; },
  });

  const chips = el('div', { class: 'date-chips' }, dates.map((d) => el('button', {
    type: 'button',
    class: `date-chip${d === selectedDate ? ' selected' : ''}${withResults.has(d) ? ' has-result' : ''}`,
    onclick: () => { location.hash = `#/tests/${d}`; },
  }, d === today ? 'Heute' : formatShortDE(d), withResults.has(d) ? ' ✓' : '')));

  const next = nextTestDate(plan, today);
  return el('section', { class: 'card' },
    el('h3', { text: 'Datum' }),
    el('label', { class: 'date-field' }, input),
    chips,
    !isTestDay(plan, selectedDate) && el('p', { class: 'muted', text: 'Kein geplanter Testtag – Eintragen geht trotzdem.' }),
    next && next !== today && el('p', { class: 'muted', text: `Nächster Testtag: ${formatDateDE(next)} (in ${daysBetween(today, next)} Tagen)` }));
}

function entryCard(ctx, tests, byKey, refresh) {
  const card = el('section', { class: 'card' },
    el('h3', { text: `Ergebnisse am ${formatDateDE(selectedDate)}` }));

  for (const test of tests) {
    const key = `${selectedDate}|${test.id}`;
    const rec = byKey.get(key);
    const n = test.attempts ?? 3;
    const bestOut = el('span', { class: 'test-best' });
    const inputs = Array.from({ length: n }, (_, i) => el('input', {
      type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'next',
      placeholder: `${i + 1}.`, 'aria-label': `${test.name}, Versuch ${i + 1}`,
      value: formatDecimal(rec?.attempts?.[i] ?? null),
    }));

    const update = () => {
      const attempts = inputs.map((x) => parseDecimal(x.value));
      inputs.forEach((x, i) => x.classList.toggle('invalid', x.value.trim() !== '' && attempts[i] == null));
      const best = bestAttempt(attempts);
      bestOut.textContent = best != null ? `Bester: ${formatDecimal(best)} ${test.unit ?? ''}` : '';
      return { attempts, best };
    };
    const save = async () => {
      const { attempts, best } = update();
      if (attempts.every((a) => a == null)) await db.del('tests', key);
      else await db.put('tests', { key, date: selectedDate, testId: test.id, attempts, best, updatedAt: Date.now() });
    };
    for (const input of inputs) {
      input.addEventListener('input', () => save().catch((err) => { console.error(err); ctx.toast('Speichern fehlgeschlagen'); }));
      input.addEventListener('change', () => refresh());
    }
    update();

    card.append(el('div', { class: 'test-entry' },
      el('div', { class: 'test-title' }, el('strong', { text: test.name }), bestOut),
      test.instructions && el('p', { class: 'muted small', text: test.instructions }),
      el('div', { class: 'attempts' }, inputs.map((x) => el('label', { class: 'field' }, x, el('span', { class: 'unit', text: test.unit ?? '' }))))));
  }
  return card;
}

function chartCard(ctx, test, records) {
  const plan = ctx.plan;
  const series = testSeries(records, test.id);
  const goal = plan.goal?.testId === test.id ? plan.goal.target : null;
  const first = series[0];
  const last = series.at(-1);
  const delta = first && last && series.length > 1 ? Math.round((last.best - first.best) * 10) / 10 : null;

  return el('section', { class: 'card chart-card' },
    el('div', { class: 'test-title' },
      el('h3', { text: test.name }),
      delta != null && el('span', { class: delta >= 0 ? 'delta up' : 'delta down', text: `${delta >= 0 ? '+' : ''}${formatDecimal(delta)} ${test.unit ?? ''}` })),
    renderChart(series.map((s) => ({ date: s.date, value: s.best })), { goal, unit: test.unit ?? '' }),
    series.length > 0 && el('ul', { class: 'plain-list compact' },
      [...series].reverse().map((s) => el('li', {},
        el('button', {
          type: 'button', class: 'link-btn',
          onclick: () => { location.hash = `#/tests/${s.date}`; },
        }, formatDateDE(s.date)),
        el('span', { text: ` ${formatDecimal(s.best)} ${test.unit ?? ''}` })))));
}
