// "Messen" – step 1: load a (slow-motion) video, detect the frame rate the
// browser actually gets, and try single-frame stepping. The full flight-time
// measurement builds on this once real iPhone videos are known to work.

import { el, toast } from '../ui.js';
import { formatDecimal } from '../util.js';
import { estimateFps, heightErrorPerFrame, rateFps, frameAt, frameSeekTime } from '../jump.js';

const SAMPLE_MAX = 60;       // frames to sample
const SAMPLE_MS = 8000;      // give up after this much wall time
const SAMPLE_RATE = 0.125;   // play slowly so the display shows every frame

let objectUrl = null; // revoked when the next video is picked

export function renderMeasure() {
  const video = el('video', { class: 'measure-video', playsinline: true, muted: true, preload: 'auto', hidden: true });
  // Attributes too: iOS checks them before the properties are applied.
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');

  const result = el('div', { class: 'measure-result', hidden: true });
  const details = el('ul', { class: 'plain-list compact measure-details' });
  const stepper = stepControls(video);

  const fileInput = el('input', { type: 'file', accept: 'video/*', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) loadVideo(file, { video, result, details, stepper });
  });

  return el('div', { class: 'measure' },
    el('h1', { text: 'Messen' }),
    el('p', { class: 'muted', text: 'Testversion: Prüft, mit welcher Bildrate die App deine Zeitlupen-Videos bekommt. Davon hängt ab, wie genau die Sprunghöhe später gemessen werden kann.' }),
    el('section', { class: 'card' },
      el('h3', { text: 'So geht’s' }),
      el('ol', { class: 'steps' },
        el('li', {}, 'Einmalig: ', el('em', { text: 'Einstellungen → Kamera → Slo-Mo aufnehmen' }), ' auf ', el('strong', { text: '240 fps' }), ' stellen.'),
        el('li', { text: 'In der Kamera-App „Zeitlupe“ wählen und ein paar Sekunden aufnehmen (z. B. einen Sprung).' }),
        el('li', { text: 'Hier auf „Video auswählen“ tippen und das Video aus der Mediathek wählen.' }),
        el('li', { text: 'Die erkannte Bildrate notieren – oder einen Screenshot machen.' })),
      el('button', { type: 'button', class: 'btn block', text: 'Video auswählen', onclick: () => fileInput.click() }),
      fileInput),
    video,
    result,
    stepper.root,
    el('section', { class: 'card measure-details-card', hidden: true }, el('h3', { text: 'Details' }), details));
}

// ---------------------------------------------------------------------------

async function loadVideo(file, ui) {
  const { video, result, details, stepper } = ui;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);

  video.hidden = false;
  stepper.root.hidden = true;
  showStatus(result, 'Video wird geladen …');
  details.closest('section').hidden = true;

  video.src = objectUrl;
  video.load();
  try {
    await once(video, 'loadedmetadata', 15000);
  } catch {
    showStatus(result, 'Das Video konnte nicht geladen werden. Ist es ein MOV/MP4-Video?', 'error');
    return;
  }

  showStatus(result, 'Bildrate wird gemessen … (dauert ein paar Sekunden)');
  const fps = await measureFps(video);
  showFps(result, fps);
  stepper.setFps(fps?.fps ?? null);
  stepper.root.hidden = false;

  details.replaceChildren(
    detail('Datei', file.name || '–'),
    detail('Typ', file.type || 'unbekannt'),
    detail('Größe', `${formatDecimal(Math.round(file.size / 1e5) / 10)} MB`),
    detail('Auflösung', video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : '–'),
    detail('Dauer', Number.isFinite(video.duration) ? `${formatDecimal(Math.round(video.duration * 100) / 100)} s` : '–'),
    detail('Gemessene Bildwechsel', fps ? String(fps.samples) : '–'),
    detail('Bildrate (roh)', fps ? `${formatDecimal(Math.round(fps.rawFps * 10) / 10)} fps` : '–'),
    detail('Browser', navigator.userAgent.match(/(iPhone OS [\d_]+|Mac OS X [\d_]+|Version\/[\d.]+|Chrome\/[\d.]+)/g)?.join(' · ') ?? '–'));
  details.closest('section').hidden = false;
}

/**
 * Plays the video slowly and records the media time of each presented frame
 * via requestVideoFrameCallback. Returns estimateFps(...) or null.
 */
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

function showStatus(box, text, kind = '') {
  box.hidden = false;
  box.className = `card measure-result ${kind}`;
  box.replaceChildren(el('p', { text }));
}

function showFps(box, fps) {
  if (!fps) {
    showStatus(box, 'Die Bildrate konnte nicht ermittelt werden (Browser zu alt oder Video zu kurz).', 'error');
    return;
  }
  const rating = rateFps(fps.fps);
  const err = heightErrorPerFrame(fps.fps);
  const verdict = {
    good: 'Sehr gut – damit lässt sich die Sprunghöhe auf etwa 1 cm genau messen.',
    ok: 'Brauchbar, aber 240 fps wären genauer.',
    poor: 'Zu ungenau für Sprungmessung. Falls du in Zeitlupe gefilmt hast, hat iOS das Video beim Auswählen vermutlich umgewandelt.',
  }[rating];

  box.hidden = false;
  box.className = `card measure-result ${rating}`;
  box.replaceChildren(
    el('div', { class: 'muted', text: 'Erkannte Bildrate' }),
    el('div', { class: 'measure-fps', text: `${fps.fps} fps` }),
    el('p', { text: `± ${formatDecimal(Math.round(err * 10) / 10)} cm pro Bild Abweichung bei 75 cm Sprunghöhe.` }),
    el('p', { class: 'measure-verdict', text: verdict }));
}

function detail(label, value) {
  return el('li', {}, el('span', { class: 'muted', text: `${label}: ` }), el('strong', { text: value }));
}

// ---------------------------------------------------------------------------
// Frame stepping (test of seek precision on iOS)

function stepControls(video) {
  let fps = null;
  const pos = el('div', { class: 'measure-pos', text: '–' });
  const update = () => {
    const t = video.currentTime;
    pos.textContent = fps
      ? `Bild ${frameAt(t, fps)} · ${formatDecimal(Math.round(t * 1000) / 1000)} s`
      : `${formatDecimal(Math.round(t * 1000) / 1000)} s`;
  };
  video.addEventListener('seeked', update);
  video.addEventListener('timeupdate', update);

  const step = (frames) => {
    if (!fps) { toast('Bildrate unbekannt'); return; }
    video.pause();
    const max = Math.max(0, Math.ceil((video.duration || 0) * fps) - 1);
    const frame = Math.min(Math.max(frameAt(video.currentTime, fps) + frames, 0), max);
    video.currentTime = frameSeekTime(frame, fps);
  };

  const root = el('section', { class: 'card measure-stepper', hidden: true },
    el('h3', { text: 'Bild für Bild' }),
    el('p', { class: 'muted small', text: 'Teste, ob das Video bei jedem Tipp genau ein Bild weiterspringt. Das braucht die spätere Messung.' }),
    pos,
    el('div', { class: 'measure-buttons' },
      el('button', { type: 'button', class: 'btn secondary', text: '◀◀ 10', onclick: () => step(-10) }),
      el('button', { type: 'button', class: 'btn secondary', text: '◀ 1', onclick: () => step(-1) }),
      el('button', { type: 'button', class: 'btn secondary', text: '1 ▶', onclick: () => step(1) }),
      el('button', { type: 'button', class: 'btn secondary', text: '10 ▶▶', onclick: () => step(10) })));

  return { root, setFps: (v) => { fps = v; update(); } };
}

function once(target, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    target.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
    target.addEventListener('error', () => { clearTimeout(timer); reject(new Error('error')); }, { once: true });
  });
}
