// Small hand-drawn SVG line chart. `chartModel` is pure (unit tested);
// `renderChart` turns the model into SVG nodes.

import { dayNumber, formatShortDE } from './plan.js';
import { formatDecimal } from './util.js';
import { svg } from './ui.js';

/** A "nice" tick step (1, 2, 2.5, 5 × 10^n) for a value range. */
export function niceStep(range, targetTicks = 4) {
  if (!(range > 0)) return 1;
  const raw = range / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * points: [{date: "yyyy-MM-dd", value: number}] (sorted or not).
 * goal: number | null. Returns coordinates for drawing.
 */
export function chartModel(points, { width = 340, height = 180, goal = null, pad = { top: 14, right: 14, bottom: 26, left: 40 } } = {}) {
  const pts = points.filter((p) => typeof p.value === 'number').sort((a, b) => dayNumber(a.date) - dayNumber(b.date));
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const values = pts.map((p) => p.value);
  if (goal != null) values.push(goal);
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  if (min === max) {
    // Single value: give it some room so the axis isn't absurdly fine-grained.
    const spread = Math.max(1, Math.abs(min) * 0.05);
    min -= spread;
    max += spread;
  }
  const step = niceStep(max - min);
  const yMin = Math.floor(min / step) * step;
  const yMax = Math.ceil(max / step) * step;

  const days = pts.map((p) => dayNumber(p.date));
  const dMin = days.length ? Math.min(...days) : 0;
  const dMax = days.length ? Math.max(...days) : 1;
  const x = (d) => (dMax === dMin ? pad.left + innerW / 2 : pad.left + ((d - dMin) / (dMax - dMin)) * innerW);
  const y = (v) => pad.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const ticks = [];
  for (let v = yMin; v <= yMax + step / 1000; v += step) ticks.push({ value: Math.round(v * 1000) / 1000, y: y(v) });

  const coords = pts.map((p, i) => ({ ...p, x: x(days[i]), y: y(p.value) }));
  const path = coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

  return {
    width, height, pad, ticks, coords, path,
    goalY: goal != null ? y(goal) : null,
    xLabels: coords.length ? [coords[0], coords.at(-1)].filter((c, i, a) => i === 0 || c !== a[0]) : [],
  };
}

/** Renders a chart. Returns an <svg> element. */
export function renderChart(points, { goal = null, goalLabel = '', unit = '', width = 340, height = 180 } = {}) {
  const m = chartModel(points, { width, height, goal });
  const right = m.width - m.pad.right;
  const root = svg('svg', {
    viewBox: `0 0 ${m.width} ${m.height}`, class: 'chart', role: 'img',
    'aria-label': `Verlauf, ${m.coords.length} Werte${goal != null ? `, Ziel ${goal} ${unit}` : ''}`,
  });

  for (const t of m.ticks) {
    root.append(
      svg('line', { class: 'chart-grid', x1: m.pad.left, x2: right, y1: t.y, y2: t.y }),
      svg('text', { class: 'chart-axis', x: m.pad.left - 6, y: t.y + 4, 'text-anchor': 'end' }, formatDecimal(t.value)));
  }

  if (m.goalY != null) {
    root.append(
      svg('line', { class: 'chart-goal', x1: m.pad.left, x2: right, y1: m.goalY, y2: m.goalY }),
      svg('text', { class: 'chart-goal-label', x: right, y: m.goalY - 5, 'text-anchor': 'end' }, goalLabel || `Ziel ${formatDecimal(goal)} ${unit}`));
  }

  if (m.coords.length > 1) root.append(svg('path', { class: 'chart-line', d: m.path }));
  m.coords.forEach((c, i) => {
    root.append(svg('circle', { class: 'chart-dot', cx: c.x, cy: c.y, r: i === m.coords.length - 1 ? 5 : 3.5 }));
  });
  const last = m.coords.at(-1);
  if (last) {
    root.append(svg('text', { class: 'chart-value', x: last.x, y: last.y - 10, 'text-anchor': last.x > m.width - 60 ? 'end' : 'middle' },
      `${formatDecimal(last.value)}${unit ? ` ${unit}` : ''}`));
  }

  m.xLabels.forEach((c, i) => {
    root.append(svg('text', {
      class: 'chart-axis', x: c.x, y: m.height - 6,
      'text-anchor': m.xLabels.length === 1 ? 'middle' : i === 0 ? 'start' : 'end',
    }, formatShortDE(c.date)));
  });

  if (m.coords.length === 0) {
    root.append(svg('text', { class: 'chart-empty', x: m.width / 2, y: m.height / 2, 'text-anchor': 'middle' }, 'Noch keine Werte'));
  }
  return root;
}
