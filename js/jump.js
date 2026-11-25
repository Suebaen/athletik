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
  // Snap to a common camera rate when within 4 %.
  const snap = COMMON_RATES.find((r) => Math.abs(rawFps - r) / r <= 0.04);
  return { fps: snap ?? Math.round(rawFps), rawFps, samples: deltas.length };
}

/** Rating of a frame rate for jump measurement: 'good' | 'ok' | 'poor'. */
export function rateFps(fps) {
  if (fps >= 200) return 'good';
  if (fps >= 100) return 'ok';
  return 'poor';
}

/** Index of the frame shown at `time` seconds (frames start at 0). */
export function frameAt(time, fps) {
  return Math.max(0, Math.floor(time * fps + 1e-6));
}

/** Seek target for a frame: its middle, so decoder rounding can't hit a neighbour. */
export function frameSeekTime(frame, fps) {
  return (Math.max(0, frame) + 0.5) / fps;
}
