// "Messen" – step 1: load a (slow-motion) video, read its exact frame rate
// and frame times from the file, and try single-frame stepping. The full
// flight-time measurement builds on this.
//
// The frame rate comes from the MP4/MOV container (js/mp4.js). Counting
// frames during playback is only a fallback: iPhones can't present 240 fps
// HEVC fast enough, so playback counting reports far too low rates.

import { el, toast } from '../ui.js';
import { formatDecimal } from '../util.js';
import { estimateFps, heightErrorPerFrame, rateFps, frameAt, frameSeekTime } from '../jump.js';
import { readVideoTiming, frameIndexAt, seekTimeForFrame } from '../mp4.js';

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
        el('li', {}, 'In ', el('em', { text: 'Fotos' }), ' das Video teilen → ', el('em', { text: 'Optionen → Alle Fotodaten' }), ' einschalten → ', el('em', { text: 'In Dateien sichern' }), '.'),
        el('li', {}, 'Hier auf „Video auswählen“ tippen → ', el('em', { text: 'Durchsuchen' }), ' → die Datei aus ', el('em', { text: 'Dateien' }), ' wählen.'),
        el('li', { text: 'Die erkannte Bildrate notieren – oder einen Screenshot machen.' })),
      el('p', { class: 'muted small', text: 'Direkt aus der Mediathek gewählt, wandelt iOS Zeitlupen in ein verlangsamtes 30-fps-Video um. Über „Dateien“ kommt das Original mit 240 fps.' }),
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
  // Exact timing from the file (independent of whether this browser can
  // decode the video); playback counting only as a fallback.
  const [timing, playable] = await Promise.all([
    readVideoTiming(file).catch((err) => { console.warn('Could not read video container', err); return null; }),
    once(video, 'loadedmetadata', 15000).then(() => true, () => false),
  ]);
  if (!timing && !playable) {
    showStatus(result, 'Das Video konnte nicht geladen werden. Ist es ein MOV/MP4-Video?', 'error');
    return;
  }

  let fps = null;
  if (timing) {
    fps = { fps: timing.fps, rawFps: timing.rawFps, samples: timing.frameCount, source: 'file' };
  } else {
    showStatus(result, 'Bildrate wird gemessen … (dauert ein paar Sekunden)');
    const measured = await measureFps(video);
    fps = measured && { ...measured, source: 'playback' };
  }
  showFps(result, fps);
  if (!playable) {
    video.hidden = true;
    result.append(el('p', { class: 'measure-verdict', text: 'Dieses Video kann der Browser nicht abspielen – Bild-für-Bild geht damit nicht.' }));
  } else {
    stepper.setTiming(timing?.frameTimes ?? null, fps?.fps ?? null);
    stepper.root.hidden = false;
  }

  details.replaceChildren(
    detail('Datei', file.name || '–'),
    detail('Typ', file.type || 'unbekannt'),
    detail('Größe', `${formatDecimal(Math.round(file.size / 1e5) / 10)} MB`),
    detail('Auflösung', video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : '–'),
    detail('Dauer', Number.isFinite(video.duration) ? `${formatDecimal(Math.round(video.duration * 100) / 100)} s` : '–'),
    detail('Quelle', fps?.source === 'file' ? 'Dateiangaben (exakt)' : fps ? 'Wiedergabe gezählt (ungenau)' : '–'),
    detail(fps?.source === 'file' ? 'Bilder im Video' : 'Gezählte Bildwechsel', fps ? String(fps.samples) : '–'),
    detail('Bildrate (roh)', fps ? `${formatDecimal(Math.round(fps.rawFps * 100) / 100)} fps` : '–'),
    timing && !timing.constantRate && detail('Hinweis', 'Bildrate im Video nicht konstant'),
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
    poor: 'Zu ungenau für Sprungmessung. Falls du in Zeitlupe gefilmt hast, hat iOS das Video beim Auswählen vermutlich umgewandelt – über „Dateien“ auswählen (siehe oben).',
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
  let frameTimes = null; // exact times from the file, when available
  const pos = el('div', { class: 'measure-pos', text: '–' });
  const currentFrame = () => (frameTimes ? frameIndexAt(frameTimes, video.currentTime) : frameAt(video.currentTime, fps));
  const update = () => {
    const time = `${formatDecimal(Math.round(video.currentTime * 1000) / 1000)} s`;
    if (!fps && !frameTimes) { pos.textContent = time; return; }
    const total = frameTimes ? ` von ${frameTimes.length}` : '';
    pos.textContent = `Bild ${currentFrame() + 1}${total} · ${time}`;
  };
  video.addEventListener('seeked', update);
  video.addEventListener('timeupdate', update);

  const step = (frames) => {
    if (!fps && !frameTimes) { toast('Bildrate unbekannt'); return; }
    video.pause();
    if (frameTimes) {
      video.currentTime = seekTimeForFrame(frameTimes, currentFrame() + frames);
      return;
    }
    const max = Math.max(0, Math.ceil((video.duration || 0) * fps) - 1);
    const frame = Math.min(Math.max(currentFrame() + frames, 0), max);
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

  return { root, setTiming: (times, rate) => { frameTimes = times?.length ? times : null; fps = rate; update(); } };
}

function once(target, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    target.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
    target.addEventListener('error', () => { clearTimeout(timer); reject(new Error('error')); }, { once: true });
  });
}
