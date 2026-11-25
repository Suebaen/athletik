// App entry: loads the plan, routes hash URLs to views, keeps "today" fresh.

import { toDateString, isValidDate } from './plan.js';
import * as db from './db.js';
import { el, toast } from './ui.js';
import { renderToday } from './views/today.js';
import { renderDay } from './views/day.js';
import { renderPlan } from './views/planview.js';
import { renderTests } from './views/tests.js';
import { renderHistory } from './views/history.js';
import { renderMore } from './views/more.js';
import { renderMeasure } from './views/measure.js';
import { initTimer } from './timer.js';

const main = document.getElementById('view');

const ctx = {
  plan: null,
  bundledPlan: null,
  planSource: 'bundled', // 'bundled' | 'imported'
  today: () => toDateString(),
  toast,
  onSetDone: null, // set by the rest timer
  rerender: () => render(),
};

// ---------------------------------------------------------------------------
// Plan loading

async function fetchBundledPlan() {
  const res = await fetch('TrainingPlan.json');
  if (!res.ok) throw new Error(`TrainingPlan.json: HTTP ${res.status}`);
  return res.json();
}

export async function loadPlan() {
  const [bundled, imported] = await Promise.all([
    fetchBundledPlan().catch((err) => { console.error(err); return null; }),
    db.getMeta('importedPlan').catch(() => undefined),
  ]);
  ctx.bundledPlan = bundled;
  if (imported?.plan) {
    ctx.plan = imported.plan;
    ctx.planSource = 'imported';
  } else {
    ctx.plan = bundled;
    ctx.planSource = 'bundled';
  }
}
ctx.reloadPlan = async () => { await loadPlan(); render(); };

// ---------------------------------------------------------------------------
// Routing

const message = (title) => async () =>
  el('section', { class: 'card' }, el('h1', { text: title }), el('a', { class: 'btn', href: '#/heute', text: 'Zu heute' }));

const routes = [
  { re: /^\/?(heute)?$/, tab: 'heute', view: () => renderToday(ctx) },
  {
    re: /^\/tag\/(\d{4}-\d{2}-\d{2})$/,
    tab: (m) => (m[1] === ctx.today() ? 'heute' : 'plan'),
    view: (m) => (isValidDate(m[1])
      ? renderDay(ctx, m[1], { isToday: m[1] === ctx.today() })
      : message('Ungültiges Datum')()),
  },
  { re: /^\/plan(?:\/([\w-]+))?(?:\/(\d+))?$/, tab: 'plan', view: (m) => renderPlan(ctx, m[1], m[2]) },
  { re: /^\/tests(?:\/(\d{4}-\d{2}-\d{2}))?$/, tab: 'tests', view: (m) => renderTests(ctx, m[1]) },
  { re: /^\/verlauf(?:\/([^/]+))?$/, tab: 'verlauf', view: (m) => renderHistory(ctx, m[1]) },
  { re: /^\/mehr$/, tab: 'mehr', view: () => renderMore(ctx) },
  { re: /^\/messen$/, tab: 'messen', view: async () => renderMeasure() },
];

function currentPath() {
  return decodeURIComponent(location.hash.replace(/^#/, ''));
}

let renderToken = 0;
let renderedPath = null;
let renderedDate = null;

async function render() {
  const token = ++renderToken;
  const path = currentPath();
  const route = routes.map((r) => ({ r, m: r.re.exec(path) })).find((x) => x.m);

  if (!ctx.plan) {
    main.replaceChildren(el('section', { class: 'card' },
      el('h1', { text: 'Plan nicht gefunden' }),
      el('p', { text: 'TrainingPlan.json konnte nicht geladen werden.' })));
    return;
  }

  let node;
  try {
    node = route ? await route.r.view(route.m) : await message('Seite nicht gefunden')();
  } catch (err) {
    console.error(err);
    node = el('section', { class: 'card' }, el('h1', { text: 'Fehler' }), el('p', { text: String(err.message ?? err) }));
  }
  if (token !== renderToken) return; // a newer navigation won

  const samePage = renderedPath === path;
  main.replaceChildren(node);
  if (!samePage) window.scrollTo(0, 0);
  renderedPath = path;
  renderedDate = ctx.today();

  const tab = route ? (typeof route.r.tab === 'function' ? route.r.tab(route.m) : route.r.tab) : null;
  for (const a of document.querySelectorAll('.tabbar a')) {
    a.classList.toggle('active', a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

window.addEventListener('hashchange', render);

// Re-render "Heute" when the date changes while the app sits in the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const path = currentPath();
  const onToday = /^\/?(heute)?$/.test(path);
  if (onToday && renderedDate !== ctx.today()) render();
});

// ---------------------------------------------------------------------------
// Start

// ---------------------------------------------------------------------------
// Service worker & update banner

function showUpdateBanner(worker) {
  const banner = document.getElementById('update-banner');
  banner.replaceChildren(el('button', {
    type: 'button', text: 'Update verfügbar – neu laden',
    onclick: () => worker.postMessage({ type: 'SKIP_WAITING' }),
  }));
  banner.hidden = false;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload for updates, not when the very first worker takes control.
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });

  const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(worker);
    });
  });
  // Installed apps stay open for days: check for updates when brought to front.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reg.update().catch(() => {});
  });
}

async function start() {
  db.requestPersistence();
  initTimer(ctx).catch((err) => console.error(err));
  await loadPlan();
  await render();
  registerServiceWorker().catch((err) => console.error('Service worker', err));
}

start();

export { ctx };
