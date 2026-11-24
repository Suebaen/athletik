// Rest timer UI: big countdown overlay (minimizable to a pill), persisted in
// IndexedDB so it survives reloads, Screen Wake Lock while running, and a
// short beep + vibration (where supported) when the rest is over.

import { el, svg } from './ui.js';
import { formatCountdown } from './plan.js';
import * as db from './db.js';
import * as T from './timerstate.js';

const STEP_MS = 15000;
const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;
const AUTO_CLOSE_MS = 15000;

let state = null;
let finishedShown = false;
let minimized = false;
let soundOn = true;
let tickHandle = null;
let autoCloseHandle = null;
let wakeLock = null;
let audioCtx = null;
let ui = null;

export async function initTimer(ctx) {
  ui = buildUI();
  document.body.append(ui.overlay, ui.pill);

  ctx.onSetDone = ({ exercise, sessionComplete }) => {
    if (sessionComplete || !exercise.restSeconds) {
      stop();
      return;
    }
    start(exercise.restSeconds, { exerciseId: exercise.id, exerciseName: exercise.name });
  };

  document.addEventListener('visibilitychange', () => {
    if (!state) return;
    if (document.visibilityState === 'visible') {
      if (!T.isFinished(state, Date.now())) acquireWakeLock();
      startTicking();
    } else {
      stopTicking();
    }
  });

  try {
    soundOn = (await db.getMeta('timerSound')) !== false;
    const saved = await db.getMeta('timer');
    const action = T.restoreAction(saved, Date.now());
    if (action === 'discard') {
      if (saved) db.deleteMeta('timer');
    } else {
      state = saved;
      finishedShown = action === 'finished';
      show();
    }
  } catch (err) {
    console.error(err);
  }
  updateSoundButton();
}

// ---------------------------------------------------------------------------
// Control

function start(seconds, info) {
  unlockAudio(); // must happen inside the user's tap
  clearTimeout(autoCloseHandle);
  state = T.startTimer(seconds, Date.now(), info);
  finishedShown = false;
  minimized = false;
  persist();
  acquireWakeLock();
  show();
}

function adjust(deltaMs) {
  if (!state) return;
  const now = Date.now();
  const wasFinished = T.isFinished(state, now);
  if (wasFinished && deltaMs < 0) return;
  state = wasFinished ? T.startTimer(deltaMs / 1000, now, state) : T.adjustTimer(state, deltaMs, now);
  finishedShown = false;
  clearTimeout(autoCloseHandle);
  persist();
  acquireWakeLock();
  show();
}

function stop() {
  state = null;
  finishedShown = false;
  clearTimeout(autoCloseHandle);
  stopTicking();
  releaseWakeLock();
  db.deleteMeta('timer').catch(() => {});
  ui.overlay.hidden = true;
  ui.pill.hidden = true;
  document.body.classList.remove('timer-open');
}

function persist() {
  db.setMeta('timer', state).catch((err) => console.error(err));
}

function setMinimized(value) {
  minimized = value;
  render();
}

// ---------------------------------------------------------------------------
// Rendering

function show() {
  render();
  startTicking();
}

function startTicking() {
  stopTicking();
  tick();
  tickHandle = setInterval(tick, 250);
}

function stopTicking() {
  clearInterval(tickHandle);
  tickHandle = null;
}

function tick() {
  if (!state) return;
  const now = Date.now();
  if (T.isFinished(state, now) && !finishedShown) {
    finishedShown = true;
    onFinished(now);
  }
  render();
}

function onFinished(now) {
  releaseWakeLock();
  minimized = false;
  // Only alert if the end happened just now (not while the app was suspended).
  if (now - state.endsAt < 3000) {
    if (soundOn) beep();
    navigator.vibrate?.([200, 100, 200]);
  }
  clearTimeout(autoCloseHandle);
  autoCloseHandle = setTimeout(stop, AUTO_CLOSE_MS);
}

function render() {
  if (!state || !ui) return;
  const now = Date.now();
  const finished = T.isFinished(state, now);
  const time = formatCountdown(T.remainingMs(state, now));

  ui.overlay.hidden = minimized;
  ui.pill.hidden = !minimized;
  document.body.classList.toggle('timer-open', !minimized);
  ui.overlay.classList.toggle('finished', finished);
  ui.pill.classList.toggle('finished', finished);

  ui.label.textContent = finished ? 'Pause vorbei' : 'Pause';
  ui.exercise.textContent = state.exerciseName ? `nach ${state.exerciseName}` : '';
  ui.time.textContent = finished ? 'Los!' : time;
  ui.pillTime.textContent = finished ? 'Los!' : time;
  ui.ring.setAttribute('stroke-dashoffset', String(RING_C * (1 - T.remainingFraction(state, now))));
  ui.minus.disabled = finished;
  ui.skip.textContent = finished ? 'Weiter' : 'Pause beenden';
}

function buildUI() {
  const ring = svg('circle', {
    class: 'timer-ring-fg', cx: 60, cy: 60, r: RING_R,
    'stroke-dasharray': RING_C, 'stroke-dashoffset': 0, transform: 'rotate(-90 60 60)',
  });
  const time = el('div', { class: 'timer-time', role: 'timer', 'aria-live': 'off' });
  const label = el('div', { class: 'timer-label' });
  const exercise = el('div', { class: 'timer-exercise' });
  const minus = el('button', { type: 'button', class: 'btn secondary', text: '−15 s', onclick: () => adjust(-STEP_MS) });
  const plus = el('button', { type: 'button', class: 'btn secondary', text: '+15 s', onclick: () => adjust(STEP_MS) });
  const skip = el('button', { type: 'button', class: 'btn block', onclick: stop });
  const sound = el('button', { type: 'button', class: 'btn-text', onclick: toggleSound });
  const minimize = el('button', { type: 'button', class: 'btn-text', text: 'Minimieren', onclick: () => setMinimized(true) });

  const panel = el('div', { class: 'timer-panel', role: 'dialog', 'aria-label': 'Pausentimer' },
    label,
    el('div', { class: 'timer-dial' },
      svg('svg', { viewBox: '0 0 120 120', class: 'timer-ring', 'aria-hidden': 'true' },
        svg('circle', { class: 'timer-ring-bg', cx: 60, cy: 60, r: RING_R }),
        ring),
      time),
    exercise,
    el('div', { class: 'timer-adjust' }, minus, plus),
    skip,
    el('div', { class: 'timer-footer' }, sound, minimize));

  const overlay = el('div', { class: 'timer', hidden: true }, panel);
  // Tapping outside the panel minimizes, so the next set can be filled in.
  overlay.addEventListener('click', (e) => { if (e.target === overlay) setMinimized(true); });

  const pillTime = el('span', { class: 'timer-pill-time' });
  const pill = el('button', {
    type: 'button', class: 'timer-pill', hidden: true, 'aria-label': 'Pausentimer öffnen',
    onclick: () => setMinimized(false),
  }, el('span', { class: 'timer-pill-label', text: 'Pause' }), pillTime);

  return { overlay, pill, ring, time, label, exercise, minus, skip, sound, pillTime };
}

// ---------------------------------------------------------------------------
// Sound

function toggleSound() {
  soundOn = !soundOn;
  db.setMeta('timerSound', soundOn).catch(() => {});
  if (soundOn) { unlockAudio(); beep(); }
  updateSoundButton();
}

function updateSoundButton() {
  if (ui) ui.sound.textContent = soundOn ? 'Ton: an' : 'Ton: aus';
}

function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    audioCtx ??= new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

function beep() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t = audioCtx.currentTime + 0.02;
  [0, 0.22, 0.44].forEach((offset, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = i === 2 ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, t + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, t + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.17);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.2);
  });
}

// ---------------------------------------------------------------------------
// Wake lock

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null; // e.g. low battery mode – the timer still works
  }
}

function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});
}
