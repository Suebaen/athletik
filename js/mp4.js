// Minimal MP4/QuickTime (ISO BMFF) reader: finds the video track and reads
// its exact frame timing from the container (mdhd, stts, ctts, elst).
// No decoding, so it works for 240 fps HEVC files that the phone can't play
// back fast enough. Everything except readVideoTiming() is pure.

import { snapFps } from './jump.js';

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts']);

function fourcc(dv, offset) {
  return String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset + 1), dv.getUint8(offset + 2), dv.getUint8(offset + 3));
}

function readUint64(dv, offset) {
  return dv.getUint32(offset) * 2 ** 32 + dv.getUint32(offset + 4);
}

function readInt64(dv, offset) {
  return dv.getInt32(offset) * 2 ** 32 + dv.getUint32(offset + 4);
}

/**
 * Box header at `offset`. `limit` is the end of the parent (for size 0 =
 * "until the end"). Returns { type, size, headerSize } or null if invalid.
 * Needs 16 readable bytes at offset (8 suffice when size != 1).
 */
export function readBoxHeader(dv, offset, limit) {
  if (offset + 8 > dv.byteLength) return null;
  let size = dv.getUint32(offset);
  const type = fourcc(dv, offset + 4);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > dv.byteLength) return null;
    size = readUint64(dv, offset + 8);
    headerSize = 16;
  } else if (size === 0) {
    size = limit - offset;
  }
  if (size < headerSize) return null;
  return { type, size, headerSize };
}

/** Child boxes of the range [start, end) in a DataView. */
function* boxes(dv, start, end) {
  let offset = start;
  while (offset + 8 <= end) {
    const h = readBoxHeader(dv, offset, end);
    if (!h) return;
    const boxEnd = Math.min(offset + h.size, end);
    yield { type: h.type, start: offset + h.headerSize, end: boxEnd };
    offset += h.size;
  }
}

/** Parses a moov payload into a list of tracks with their timing tables. */
export function parseMoov(dv, start = 0, end = dv.byteLength) {
  const tracks = [];
  for (const box of boxes(dv, start, end)) {
    if (box.type === 'trak') tracks.push(parseTrak(dv, box.start, box.end));
  }
  return tracks;
}

function parseTrak(dv, start, end) {
  const track = { handler: null, timescale: null, duration: null, stts: [], ctts: [], mediaTime: null };
  const visit = (s, e) => {
    for (const box of boxes(dv, s, e)) {
      const p = box.start;
      switch (box.type) {
        case 'mdhd': {
          const version = dv.getUint8(p);
          if (version === 1) {
            track.timescale = dv.getUint32(p + 20);
            track.duration = readUint64(dv, p + 24);
          } else {
            track.timescale = dv.getUint32(p + 12);
            track.duration = dv.getUint32(p + 16);
          }
          break;
        }
        case 'hdlr':
          // QuickTime also has a data handler (dhlr: 'alis'/'url ') in minf;
          // the media handler in mdia comes first and is the one we want.
          track.handler ??= fourcc(dv, p + 8);
          break;
        case 'stts':
          track.stts = readPairs(dv, p, (o) => [dv.getUint32(o), dv.getUint32(o + 4)]);
          break;
        case 'ctts':
          // Version 0 is formally unsigned, but encoders write signed values.
          track.ctts = readPairs(dv, p, (o) => [dv.getUint32(o), dv.getInt32(o + 4)]);
          break;
        case 'elst': {
          const version = dv.getUint8(p);
          const count = dv.getUint32(p + 4);
          const entrySize = version === 1 ? 20 : 12;
          for (let i = 0; i < count; i++) {
            const o = p + 8 + i * entrySize;
            const mediaTime = version === 1 ? readInt64(dv, o + 8) : dv.getInt32(o + 4);
            if (mediaTime >= 0) { track.mediaTime = mediaTime; break; } // skip empty edits
          }
          break;
        }
        default:
          if (CONTAINERS.has(box.type)) visit(box.start, box.end);
      }
    }
  };
  visit(start, end);
  return track;
}

function readPairs(dv, p, read) {
  const count = dv.getUint32(p + 4);
  const out = [];
  for (let i = 0; i < count && p + 8 + i * 8 + 8 <= dv.byteLength; i++) out.push(read(p + 8 + i * 8));
  return out;
}

/**
 * Timing of a video track: frame presentation times in seconds (sorted,
 * starting at the edit-list start), frame rate, duration.
 */
export function videoTiming(track) {
  if (!track?.timescale || track.stts.length === 0) return null;
  const ts = track.timescale;

  // Decode timestamps from stts, then add composition offsets from ctts.
  const pts = [];
  let dts = 0;
  for (const [count, delta] of track.stts) {
    for (let i = 0; i < count; i++) { pts.push(dts); dts += delta; }
  }
  if (track.ctts.length) {
    let k = 0;
    for (const [count, offset] of track.ctts) {
      for (let i = 0; i < count && k < pts.length; i++) pts[k++] += offset;
    }
  }
  pts.sort((a, b) => a - b);
  const origin = track.mediaTime ?? pts[0];
  const frameTimes = pts.map((t) => (t - origin) / ts);

  const frameCount = pts.length;
  const totalTicks = dts;
  const rawFps = totalTicks > 0 ? (frameCount * ts) / totalTicks : 0;
  const deltas = track.stts.map(([, d]) => d);
  return {
    fps: snapFps(rawFps),
    rawFps,
    frameCount,
    durationSec: totalTicks / ts,
    constantRate: deltas.every((d) => d === deltas[0]),
    frameTimes,
  };
}

/** Video timing from a complete file in memory (used by tests). */
export function videoTimingFromBuffer(buffer) {
  const dv = new DataView(buffer);
  for (const box of boxes(dv, 0, dv.byteLength)) {
    if (box.type === 'moov') return videoTimingFromMoov(dv, box.start, box.end);
  }
  return null;
}

export function videoTimingFromMoov(dv, start = 0, end = dv.byteLength) {
  const video = parseMoov(dv, start, end).find((t) => t.handler === 'vide');
  return videoTiming(video);
}

/**
 * Reads the timing from a File/Blob without loading the whole video:
 * walks the top-level boxes via slices and only reads `moov`.
 */
export async function readVideoTiming(blob) {
  let offset = 0;
  while (offset + 8 <= blob.size) {
    const head = new DataView(await blob.slice(offset, offset + 16).arrayBuffer());
    const h = readBoxHeader(head, 0, blob.size - offset);
    if (!h) return null;
    if (h.type === 'moov') {
      const moov = new DataView(await blob.slice(offset + h.headerSize, offset + h.size).arrayBuffer());
      return videoTimingFromMoov(moov);
    }
    offset += h.size;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Frame navigation on exact frame times

/** Index of the frame shown at time t (last frame starting at or before t). */
export function frameIndexAt(frameTimes, t) {
  let lo = 0;
  let hi = frameTimes.length - 1;
  if (hi < 0 || t < frameTimes[0]) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frameTimes[mid] <= t + 1e-6) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Seek target for frame i: the middle of that frame. */
export function seekTimeForFrame(frameTimes, i) {
  const n = frameTimes.length;
  const k = Math.min(Math.max(i, 0), n - 1);
  const start = frameTimes[k];
  const next = k + 1 < n ? frameTimes[k + 1] : start + (n > 1 ? frameTimes[k] - frameTimes[k - 1] : 0.001);
  return (start + next) / 2;
}
