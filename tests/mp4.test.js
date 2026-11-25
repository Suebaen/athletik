import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { videoTimingFromBuffer, readBoxHeader, frameIndexAt, seekTimeForFrame } from '../js/mp4.js';

// Fixtures generated with ffmpeg (testsrc2, 64×64), see tests/fixtures.
function load(name) {
  const bytes = readFileSync(new URL('./fixtures/' + name, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('240 fps H.264 with B-frames (ctts + edit list)', () => {
  const t = videoTimingFromBuffer(load('v240-bframes.mp4'));
  assert.equal(t.fps, 240);
  assert.equal(t.frameCount, 120);
  assert.equal(t.constantRate, true);
  close(t.durationSec, 0.5);
  // Presentation times are exactly k/240 despite reordered B-frames.
  t.frameTimes.forEach((ft, k) => close(ft, k / 240));
});

test('240 fps QuickTime with moov at the end (iPhone layout)', () => {
  const t = videoTimingFromBuffer(load('v240-moov-at-end.mov'));
  assert.equal(t.fps, 240);
  assert.equal(t.frameCount, 120);
});

test('240 fps HEVC .mov (like iPhone Slo-Mo originals)', () => {
  const t = videoTimingFromBuffer(load('v240-hevc.mov'));
  assert.equal(t.fps, 240);
  assert.equal(t.frameCount, 120);
  t.frameTimes.forEach((ft, k) => close(ft, k / 240));
});

test('picks the video track when there is audio', () => {
  const t = videoTimingFromBuffer(load('v30-with-audio.mov'));
  assert.equal(t.fps, 30);
  assert.equal(t.frameCount, 30);
});

test('24 fps', () => {
  const t = videoTimingFromBuffer(load('v24.mp4'));
  assert.equal(t.fps, 24);
  assert.equal(t.frameCount, 24);
});

test('garbage and empty input return null', () => {
  assert.equal(videoTimingFromBuffer(new ArrayBuffer(0)), null);
  assert.equal(videoTimingFromBuffer(new Uint8Array([0, 0, 0, 4, 1, 2, 3, 4, 5, 6]).buffer), null);
});

test('readBoxHeader handles 64-bit and to-end sizes', () => {
  const b = new DataView(new ArrayBuffer(32));
  b.setUint32(0, 1); b.setUint32(4, 0x6d646174); // 'mdat'
  b.setUint32(8, 1); b.setUint32(12, 16); // largesize = 2^32 + 16
  assert.deepEqual(readBoxHeader(b, 0, 32), { type: 'mdat', size: 2 ** 32 + 16, headerSize: 16 });
  b.setUint32(16, 0); b.setUint32(20, 0x6d6f6f76); // 'moov', size 0
  assert.deepEqual(readBoxHeader(b, 16, 32), { type: 'moov', size: 16, headerSize: 8 });
  b.setUint32(16, 4);
  assert.equal(readBoxHeader(b, 16, 32), null);
});

test('frame navigation on exact frame times', () => {
  const times = Array.from({ length: 10 }, (_, k) => k / 240);
  assert.equal(frameIndexAt(times, 0), 0);
  assert.equal(frameIndexAt(times, 3 / 240), 3);
  assert.equal(frameIndexAt(times, 3.9 / 240), 3);
  assert.equal(frameIndexAt(times, 99), 9);
  assert.equal(frameIndexAt(times, -1), 0);
  close(seekTimeForFrame(times, 3), 3.5 / 240);
  close(seekTimeForFrame(times, 9), 9.5 / 240);
  close(seekTimeForFrame(times, 50), 9.5 / 240);
  // Stepping +1 from a seek target always lands on the next frame.
  let t = 0;
  for (let i = 1; i <= 9; i++) {
    t = seekTimeForFrame(times, frameIndexAt(times, t) + 1);
    assert.equal(frameIndexAt(times, t), i);
  }
});
