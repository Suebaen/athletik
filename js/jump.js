// Pure jump-measurement math (flight-time method) and frame-rate estimation.
// Used by the "Messen" tab.

export const G = 9.81; // m/s²

/** Jump height in cm from flight time in seconds: h = g·t²/8. */
export function flightTimeToHeight(seconds) {
  if (!(seconds > 0)) return 0;
  return (G * seconds * seconds / 8) * 100;
}

/** Flight time in seconds for a jump height in cm. */
export function heightToFlightTime(cm) {
  if (!(cm > 0)) return 0;
  return Math.sqrt((8 * cm / 100) / G);
}

/**
 * Height error in cm caused by being off by one frame, at a given jump
 * height. dh/dt = g·t/4, so one frame (1/fps) shifts the height by g·t/(4·fps).
 */
export function heightErrorPerFrame(fps, atHeightCm = 75) {
  if (!(fps > 0)) return Infinity;
  const t = heightToFlightTime(atHeightCm);
  return (G * t / (4 * fps)) * 100;
}

const COMMON_RATES = [24, 25, 30, 48, 50, 60, 100, 120, 240];

/**
 * Estimates the frame rate from the media timestamps (seconds) of
 * consecutively presented frames. Playback may drop or repeat frames, so
 * deltas can be multiples of the true frame duration; the 25th percentile
 * of the positive deltas is a robust estimate of a single frame.
 * Returns { fps, rawFps, samples } or null if there is not enough data.
 */
export function estimateFps(mediaTimes, minSamples = 5) {
  const deltas = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    const d = mediaTimes[i] - mediaTimes[i - 1];
    if (d > 1e-5) deltas.push(d);
  }
  if (deltas.length < minSamples) return null;
  deltas.sort((a, b) => a - b);
  const frame = deltas[Math.floor((deltas.length - 1) * 0.25)];
  const rawFps = 1 / frame;
  return { fps: snapFps(rawFps), rawFps, samples: deltas.length };
}

/** Snaps to a common camera rate when within 4 % (29.97 → 30), else rounds. */
export function snapFps(rawFps) {
  const snap = COMMON_RATES.find((r) => Math.abs(rawFps - r) / r <= 0.04);
  return snap ?? Math.round(rawFps);
}

/** Rating of a frame rate for jump measurement: 'good' | 'ok' | 'poor'. */
export function rateFps(fps) {
  if (fps >= 200) return 'good';
  if (fps >= 100) return 'ok';
  return 'poor';
}

/**
 * Frame start times for a constant-rate video, used when the exact times
 * can't be read from the file.
 */
export function fpsFrameTimes(fps, durationSec) {
  if (!(fps > 0) || !(durationSec > 0)) return [];
  const count = Math.max(1, Math.round(durationSec * fps));
  return Array.from({ length: count }, (_, k) => k / fps);
}

/** Slow-motion factors for videos picked from the photo library. */
export const SLOW_FACTORS = [
  { factor: 8, label: 'Zeitlupe 8×', hint: '240 fps' },
  { factor: 4, label: 'Zeitlupe 4×', hint: '120 fps' },
  { factor: 1, label: 'Normal', hint: 'keine Zeitlupe' },
];

/**
 * Default slow-motion factor for a video. Real-time originals (≥ 100 fps)
 * need none; a 30 fps video is most likely a Slo-Mo rendered by Photos.
 */
export function defaultSlowFactor(fps) {
  if (fps >= 100) return 1;
  return fps <= 31 ? 8 : 1;
}

export const MIN_FLIGHT_S = 0.2; // ≈ 5 cm
export const MAX_FLIGHT_S = 0.9; // ≈ 99 cm

/**
 * Jump from two marked frames. takeoff = first frame in the air,
 * landing = first frame touching the ground again. Times are video times;
 * slowFactor converts them to real time (8 for a Photos Slo-Mo at 240 fps).
 * Returns null if a mark is missing, or { error } / { flightSec, heightCm,
 * errorCm, frames, warning }.
 */
export function jumpResult(frameTimes, takeoff, landing, { fps, slowFactor = 1 } = {}) {
  if (takeoff == null || landing == null) return null;
  if (!frameTimes[takeoff] && frameTimes[takeoff] !== 0) return null;
  if (!frameTimes[landing] && frameTimes[landing] !== 0) return null;
  if (landing <= takeoff) return { error: 'order' };

  const flightSec = (frameTimes[landing] - frameTimes[takeoff]) / slowFactor;
  const heightCm = Math.round(flightTimeToHeight(flightSec) * 10) / 10;
  const errorCm = heightErrorPerFrame(fps * slowFactor, heightCm);
  let warning = null;
  if (flightSec < MIN_FLIGHT_S) warning = 'short';
  else if (flightSec > MAX_FLIGHT_S) warning = 'long';
  return { flightSec, heightCm, errorCm, frames: landing - takeoff, warning };
}

/**
 * Puts a new value into a test's attempts (fixed length n): the first empty
 * slot, otherwise it replaces the lowest attempt if the new value is higher.
 * Returns { attempts, index, replaced } – index null if nothing changed.
 */
export function addAttempt(attempts, value, n) {
  const a = Array.from({ length: n }, (_, i) => attempts?.[i] ?? null);
  const free = a.indexOf(null);
  if (free >= 0) {
    a[free] = value;
    return { attempts: a, index: free, replaced: null };
  }
  let min = 0;
  for (let i = 1; i < n; i++) if (a[i] < a[min]) min = i;
  if (value <= a[min]) return { attempts: a, index: null, replaced: null };
  const replaced = a[min];
  a[min] = value;
  return { attempts: a, index: min, replaced };
}
