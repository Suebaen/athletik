// "Messen": jump height from a slow-motion video (flight-time method).
//
// Two sources work:
//  - Original from "Dateien": real-time 240 fps file, exact frame times are
//    read from the container (js/mp4.js).
//  - Picked from the photo library: iOS renders Slo-Mo as a 30 fps video that
//    plays 8× slower; every frame of the slowed part is one 1/240 s frame, so
//    video time ÷ 8 = real time.
// Counting frames during playback is only a fallback when the container
// can't be read (iPhones can't present 240 fps HEVC in real time).

import { el, toast } from '../ui.js';
import { formatDecimal } from '../util.js';
import {
  estimateFps, heightErrorPerFrame, fpsFrameTimes, defaultSlowFactor, jumpResult, addAttempt,
  SLOW_FACTORS, MIN_FLIGHT_S, MAX_FLIGHT_S,
} from '../jump.js';
import { readVideoTiming, frameIndexAt, seekTimeForFrame } from '../mp4.js';
import { bestAttempt } from '../stats.js';
import { formatDateDE } from '../plan.js';
import * as db from '../db.js';

const SAMPLE_MAX = 60;       // fallback: frames to sample during playback
const SAMPLE_MS = 8000;      // fallback: give up after this much wall time
const SAMPLE_RATE = 0.125;   // fallback: play slowly so every frame is shown

let objectUrl = null; // revoked when the next video is picked

const fmt = (n, digits) => formatDecimal(Math.round(n * 10 ** digits) / 10 ** digits);

export async function renderMeasure(ctx) {
  const savedFactor = await db.getMeta('measureSlowFactor').catch(() => undefined);
  const test = (ctx.plan.tests ?? []).find((t) => t.id === (ctx.plan.goal?.testId ?? 'cmj'));

  const state = {
    fps: null, source: null, frameTimes: [], slowFactor: 1, playable: false,
    takeoff: null, landing: null, savedFactor,
  };

  const video = el('video', { class: 'measure-video', playsinline: true, muted: true, preload: 'auto', hidden: true });
  video.setAttribute('playsinline', ''); // iOS reads the attributes
  video.setAttribute('muted', '');

  const sourceCard = el('section', { class: 'card measure-source', hidden: true });
  const controls = el('section', { class: 'card measure-controls', hidden: true });
  const resultCard = el('section', { class: 'card measure-result', hidden: true });
  const detailsList = el('ul', { class: 'plain-list compact measure-details' });
  const detailsCard = el('details', { class: 'card measure-details-card', hidden: true },
    el('summary', { text: 'Technische Details' }), detailsList);

  // --- position, slider, stepping -----------------------------------------
  const pos = el('div', { class: 'measure-pos', text: '–' });
  const slider = el('input', { type: 'range', min: '0', max: '0', step: '1', value: '0', class: 'measure-slider', 'aria-label': 'Bild wählen' });
  const playBtn = el('button', { type: 'button', class: 'btn secondary', text: '▶︎', 'aria-label': 'Abspielen' });
  const marks = el('div', { class: 'measure-marks' });

  const currentFrame = () => frameIndexAt(state.frameTimes, video.currentTime);
  const seekFrame = (i) => {
    if (!state.frameTimes.length) return;
    video.pause();
    video.currentTime = seekTimeForFrame(state.frameTimes, i);
  };
  const updatePosition = () => {
    if (!state.frameTimes.length) { pos.textContent = '–'; return; }
    const i = currentFrame();
    pos.textContent = `Bild ${i + 1} von ${state.frameTimes.length} · ${fmt(video.currentTime, 3)} s`;
    if (document.activeElement !== slider) slider.value = String(i);
  };
  video.addEventListener('seeked', updatePosition);
  video.addEventListener('timeupdate', updatePosition);
  video.addEventListener('play', () => { playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', 'Pause'); });
  video.addEventListener('pause', () => { playBtn.textContent = '▶︎'; playBtn.setAttribute('aria-label', 'Abspielen'); });
  slider.addEventListener('input', () => seekFrame(Number(slider.value)));
  playBtn.addEventListener('click', () => (video.paused ? video.play().catch(() => {}) : video.pause()));

  const stepBtn = (label, n) => el('button', { type: 'button', class: 'btn secondary', text: label, onclick: () => seekFrame(currentFrame() + n) });
  const mark = (which) => {
    state[which] = currentFrame();
    updateMarks();
    updateResult();
  };

  controls.append(
    pos,
    el('div', { class: 'measure-scrub' }, playBtn, slider),
    el('div', { class: 'measure-buttons' }, stepBtn('◀◀ 10', -10), stepBtn('◀ 1', -1), stepBtn('1 ▶', 1), stepBtn('10 ▶▶', 10)),
    el('div', { class: 'measure-mark-buttons' },
      el('button', { type: 'button', class: 'btn mark-takeoff', onclick: () => mark('takeoff') },
        el('strong', { text: 'Absprung' }), el('span', { text: 'erstes Bild in der Luft' })),
      el('button', { type: 'button', class: 'btn mark-landing', onclick: () => mark('landing') },
        el('strong', { text: 'Landung' }), el('span', { text: 'erstes Bild am Boden' }))),
    marks);

  function updateMarks() {
    const chip = (which, label) => {
      const i = state[which];
      if (i == null) return el('span', { class: 'mark-chip empty', text: `${label}: –` });
      return el('button', {
        type: 'button', class: `mark-chip ${which}`, onclick: () => seekFrame(i),
        'aria-label': `Zu ${label} springen`,
      }, `${label}: Bild ${i + 1}`);
    };
    marks.replaceChildren(chip('takeoff', 'Absprung'), chip('landing', 'Landung'));
  }

  // --- source: frame rate and slow-motion factor ---------------------------
  function updateSource() {
    const { fps } = state;
    sourceCard.hidden = false;
    if (!fps) {
      sourceCard.replaceChildren(el('p', { text: 'Die Bildrate konnte nicht ermittelt werden. Messen ist mit diesem Video nicht möglich.' }));
      return;
    }
    const effective = fps * state.slowFactor;
    const children = [
      el('div', { class: 'source-line' },
        el('strong', { text: `${fps} fps` }),
        el('span', { class: 'muted', text: state.source === 'file' ? ' · aus der Videodatei' : ' · aus der Wiedergabe geschätzt' })),
    ];
    if (fps >= 100) {
      children.push(el('p', { class: 'muted small', text: 'Original-Zeitlupe in Echtzeit – keine Umrechnung nötig.' }));
    } else {
      children.push(
        el('p', { class: 'small', text: 'Zeitlupe aus der Mediathek? iOS hat sie dann verlangsamt. Bitte wählen:' }),
        el('div', { class: 'date-chips' }, SLOW_FACTORS.map((f) => el('button', {
          type: 'button', class: `date-chip${f.factor === state.slowFactor ? ' selected' : ''}`,
          onclick: () => {
            state.slowFactor = f.factor;
            state.savedFactor = f.factor;
            db.setMeta('measureSlowFactor', f.factor).catch(() => {});
            updateSource();
            updateResult();
          },
        }, `${f.label} `, el('span', { class: 'chip-hint', text: f.hint })))),
        state.slowFactor > 1 && el('p', { class: 'muted small', text: 'Der Sprung muss im verlangsamten Teil liegen (meist die Mitte). Am Anfang und Ende läuft das Video in Normalgeschwindigkeit.' }));
    }
    children.push(el('p', { class: 'muted small', text: `Genauigkeit: ± ${fmt(heightErrorPerFrame(effective), 1)} cm pro Bild (effektiv ${effective} fps).` }));
    sourceCard.replaceChildren(...children.filter(Boolean));
  }

  // --- result ----------------------------------------------------------------
  function updateResult() {
    resultCard.hidden = false;
    const r = jumpResult(state.frameTimes, state.takeoff, state.landing, { fps: state.fps, slowFactor: state.slowFactor });
    if (!r) {
      resultCard.replaceChildren(el('p', { class: 'muted', text: 'Spule zum Absprung (erstes Bild, in dem beide Füße in der Luft sind) und tippe „Absprung“. Dann zum ersten Bild mit Bodenkontakt und „Landung“ tippen.' }));
      return;
    }
    if (r.error) {
      resultCard.replaceChildren(el('p', { class: 'notice error', text: 'Die Landung muss nach dem Absprung liegen.' }));
      return;
    }
    const warning = r.warning === 'short'
      ? `Flugzeit unter ${fmt(MIN_FLIGHT_S, 1)} s – stimmen die Markierungen${state.slowFactor > 1 ? ' und liegt der Sprung im verlangsamten Teil' : ''}?`
      : r.warning === 'long'
        ? `Flugzeit über ${fmt(MAX_FLIGHT_S, 1)} s ist unrealistisch – ${state.fps < 100 && state.slowFactor === 1 ? 'ist das eine Zeitlupe? Dann oben „Zeitlupe 8×“ wählen.' : 'stimmen die Markierungen?'}`
        : null;

    const saveBtn = test && el('button', {
      type: 'button', class: 'btn block', text: `Als ${test.name.replace(/\s*\(.*\)/, '')}-Versuch speichern (heute)`,
      onclick: () => save(r.heightCm).catch((err) => { console.error(err); toast('Speichern fehlgeschlagen'); }),
    });

    resultCard.replaceChildren(...[
      el('div', { class: 'muted', text: 'Sprunghöhe' }),
      el('div', { class: 'measure-height', text: `${fmt(r.heightCm, 1)} cm` }),
      el('p', { class: 'measure-sub', text: `Flugzeit ${fmt(r.flightSec, 3)} s · ${r.frames} Bilder · ± ${fmt(r.errorCm, 1)} cm pro Bild` }),
      warning && el('p', { class: 'notice warn', text: warning }),
      saveBtn,
    ].filter(Boolean)); // native replaceChildren would print null/false
  }

  async function save(heightCm) {
    const date = ctx.today();
    const key = `${date}|${test.id}`;
    const rec = await db.get('tests', key);
    const res = addAttempt(rec?.attempts, heightCm, test.attempts ?? 3);
    if (res.index == null) {
      toast(`Alle ${test.attempts ?? 3} Versuche belegt – ${fmt(heightCm, 1)} cm ist nicht besser`);
      return;
    }
    await db.put('tests', {
      key, date, testId: test.id, attempts: res.attempts, best: bestAttempt(res.attempts), updatedAt: Date.now(),
    });
    toast(res.replaced != null
      ? `Gespeichert, ersetzt ${fmt(res.replaced, 1)} cm`
      : `Gespeichert als Versuch ${res.index + 1} am ${formatDateDE(date, { withYear: false })}`);
  }

  // --- loading -----------------------------------------------------------------
  const fileInput = el('input', { type: 'file', accept: 'video/*', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) load(file).catch((err) => { console.error(err); toast('Video konnte nicht geladen werden'); });
  });

  async function load(file) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    Object.assign(state, { fps: null, source: null, frameTimes: [], takeoff: null, landing: null, playable: false });
    for (const node of [video, controls, resultCard, detailsCard]) node.hidden = true;
    sourceCard.hidden = false;
    sourceCard.replaceChildren(el('p', { text: 'Video wird geladen …' }));

    video.src = objectUrl;
    video.load();
    const [timing, playable] = await Promise.all([
      readVideoTiming(file).catch((err) => { console.warn('Could not read video container', err); return null; }),
      once(video, 'loadedmetadata', 15000).then(() => true, () => false),
    ]);
    state.playable = playable;

    if (timing) {
      Object.assign(state, { fps: timing.fps, source: 'file', frameTimes: timing.frameTimes });
    } else if (playable) {
      sourceCard.replaceChildren(el('p', { text: 'Bildrate wird geschätzt … (ein paar Sekunden)' }));
      const est = await measureFps(video);
      if (est) Object.assign(state, { fps: est.fps, source: 'playback', frameTimes: fpsFrameTimes(est.fps, video.duration) });
    }
    if (!state.fps && !playable) {
      sourceCard.replaceChildren(el('p', { class: 'notice error', text: 'Das Video konnte nicht geladen werden. Ist es ein MOV/MP4-Video?' }));
      return;
    }

    state.slowFactor = state.fps >= 100 ? 1 : (state.savedFactor ?? defaultSlowFactor(state.fps));
    updateSource();

    if (playable && state.frameTimes.length) {
      video.hidden = false;
      controls.hidden = false;
      slider.max = String(state.frameTimes.length - 1);
      slider.value = '0';
      updateMarks();
      updatePosition();
      updateResult();
    } else if (!playable) {
      sourceCard.append(el('p', { class: 'notice error', text: 'Dieses Video kann der Browser nicht abspielen.' }));
    }

    detailsList.replaceChildren(...[
      detail('Datei', file.name || '–'),
      detail('Typ', file.type || 'unbekannt'),
      detail('Größe', `${fmt(file.size / 1e6, 1)} MB`),
      detail('Auflösung', video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : '–'),
      detail('Dauer', Number.isFinite(video.duration) ? `${fmt(video.duration, 2)} s` : '–'),
      detail('Bilder', String(state.frameTimes.length || '–')),
      detail('Bildrate (roh)', timing ? `${fmt(timing.rawFps, 2)} fps` : state.fps ? `${state.fps} fps (geschätzt)` : '–'),
      timing && !timing.constantRate && detail('Hinweis', 'Bildrate im Video nicht konstant'),
      detail('Browser', navigator.userAgent.match(/(iPhone OS [\d_]+|Mac OS X [\d_]+|Version\/[\d.]+|Chrome\/[\d.]+)/g)?.join(' · ') ?? '–'),
    ].filter(Boolean));
    detailsCard.hidden = false;
  }

  // --- page --------------------------------------------------------------------
  return el('div', { class: 'measure' },
    el('h1', { text: 'Messen' }),
    el('p', { class: 'muted', text: 'Sprunghöhe aus der Flugzeit: in Zeitlupe filmen, Absprung und Landung markieren.' }),
    el('details', { class: 'card howto' },
      el('summary', { text: 'Anleitung' }),
      el('ol', { class: 'steps' },
        el('li', {}, 'Einmalig: ', el('em', { text: 'Einstellungen → Kamera → Slo-Mo aufnehmen' }), ' auf ', el('strong', { text: '240 fps' }), '.'),
        el('li', { text: 'Handy auf den Boden, ca. 2 m entfernt, Füße gut sichtbar. In der Kamera-App „Zeitlupe“, Aufnahme starten, springen, stoppen. Den Sprung ungefähr in der Mitte der Aufnahme machen.' }),
        el('li', {}, el('strong', { text: 'Einfach: ' }), 'Video hier aus der Mediathek wählen und „Zeitlupe 8×“ lassen.'),
        el('li', {}, el('strong', { text: 'Alternativ (Original): ' }), 'in Fotos teilen → Optionen → Alle Fotodaten → In Dateien sichern, dann hier über „Durchsuchen“ wählen.'),
        el('li', { text: 'Wie beim Absprung landen: Beine gestreckt, auf den Zehen. Mit gebeugten Knien landen verlängert die Flugzeit und macht das Ergebnis zu hoch.' }))),
    el('button', { type: 'button', class: 'btn block', text: 'Video auswählen', onclick: () => fileInput.click() }),
    fileInput,
    sourceCard,
    video,
    controls,
    resultCard,
    detailsCard);
}

function detail(label, value) {
  return el('li', {}, el('span', { class: 'muted', text: `${label}: ` }), el('strong', { text: value }));
}

/** Fallback: estimate fps by counting presented frames during slow playback. */
async function measureFps(video) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return null;
  const times = [];
  const started = performance.now();
  video.currentTime = 0;
  video.playbackRate = SAMPLE_RATE;
  video.defaultPlaybackRate = SAMPLE_RATE;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const onFrame = (_now, meta) => {
      times.push(meta.mediaTime);
      if (times.length >= SAMPLE_MAX || performance.now() - started > SAMPLE_MS || video.ended) finish();
      else video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    video.addEventListener('ended', finish, { once: true });
    setTimeout(finish, SAMPLE_MS + 500);
    video.play().catch(finish);
  });
  video.pause();
  video.playbackRate = 1;
  video.defaultPlaybackRate = 1;
  video.currentTime = 0;
  return estimateFps(times);
}

function once(target, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    target.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
    target.addEventListener('error', () => { clearTimeout(timer); reject(new Error('error')); }, { once: true });
  });
}
