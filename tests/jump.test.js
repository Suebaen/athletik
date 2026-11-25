import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flightTimeToHeight, heightToFlightTime, heightErrorPerFrame, estimateFps, rateFps,
  fpsFrameTimes, defaultSlowFactor, jumpResult, addAttempt,
} from '../js/jump.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} ${msg ?? ''}`);

test('flight time ↔ height', () => {
  close(flightTimeToHeight(0.5), 30.66, 0.01);
  close(heightToFlightTime(75), 0.782, 0.001);
  close(flightTimeToHeight(heightToFlightTime(62.3)), 62.3, 1e-9);
  assert.equal(flightTimeToHeight(0), 0);
  assert.equal(flightTimeToHeight(-1), 0);
  assert.equal(heightToFlightTime(0), 0);
});

test('heightErrorPerFrame matches the numbers shown to the user', () => {
  close(heightErrorPerFrame(240), 0.80, 0.01);
  close(heightErrorPerFrame(60), 3.2, 0.05);
  close(heightErrorPerFrame(30), 6.4, 0.1);
  assert.equal(heightErrorPerFrame(0), Infinity);
});

const frames = (fps, n, start = 0, every = 1) => Array.from({ length: n }, (_, i) => start + (i * every) / fps);

test('estimateFps on clean frame sequences', () => {
  assert.equal(estimateFps(frames(240, 40)).fps, 240);
  assert.equal(estimateFps(frames(30, 20)).fps, 30);
  assert.equal(estimateFps(frames(60, 20, 1.5)).fps, 60);
  assert.equal(estimateFps(frames(29.97, 20)).fps, 30);
});

test('estimateFps tolerates dropped and repeated frames', () => {
  // 240 fps video, but the display skipped every other frame most of the time.
  const t = [0, 2, 3, 5, 6, 8, 9, 10, 12, 13, 15, 16, 17, 19, 20, 21].map((i) => i / 240);
  t.splice(5, 0, t[4]); // a repeated frame (delta 0) is ignored
  assert.equal(estimateFps(t).fps, 240);
});

test('estimateFps needs enough samples and leaves unusual rates unsnapped', () => {
  assert.equal(estimateFps([0, 1 / 240]), null);
  assert.equal(estimateFps([]), null);
  assert.equal(estimateFps(frames(180, 30)).fps, 180);
});

test('rateFps', () => {
  assert.equal(rateFps(240), 'good');
  assert.equal(rateFps(120), 'ok');
  assert.equal(rateFps(60), 'poor');
  assert.equal(rateFps(30), 'poor');
});

test('fpsFrameTimes', () => {
  const t = fpsFrameTimes(240, 0.5);
  assert.equal(t.length, 120);
  close(t[1], 1 / 240, 1e-12);
  assert.deepEqual(fpsFrameTimes(0, 1), []);
  assert.deepEqual(fpsFrameTimes(30, NaN), []);
});

test('defaultSlowFactor', () => {
  assert.equal(defaultSlowFactor(240), 1);
  assert.equal(defaultSlowFactor(120), 1);
  assert.equal(defaultSlowFactor(30), 8);
  assert.equal(defaultSlowFactor(60), 1);
});

test('jumpResult from a 240 fps original', () => {
  const times = fpsFrameTimes(240, 3);
  // 0.75 s flight = 180 frames at 240 fps → 68.98 cm
  const r = jumpResult(times, 100, 280, { fps: 240 });
  close(r.flightSec, 0.75, 1e-9);
  assert.equal(r.heightCm, 69);
  assert.equal(r.frames, 180);
  assert.equal(r.warning, null);
  close(r.errorCm, 0.77, 0.01);
});

test('jumpResult from a Photos Slo-Mo (30 fps video, 8× slower)', () => {
  const times = fpsFrameTimes(30, 40);
  // Same 0.75 s jump: 180 frames, 6 s of video time.
  const r = jumpResult(times, 300, 480, { fps: 30, slowFactor: 8 });
  close(r.flightSec, 0.75, 1e-9);
  assert.equal(r.heightCm, 69);
  close(r.errorCm, 0.77, 0.01); // effectively 240 fps
  // Forgetting the factor makes it absurd → warning.
  assert.equal(jumpResult(times, 300, 480, { fps: 30, slowFactor: 1 }).warning, 'long');
});

test('jumpResult edge cases', () => {
  const times = fpsFrameTimes(240, 1);
  assert.equal(jumpResult(times, null, 10, { fps: 240 }), null);
  assert.equal(jumpResult(times, 10, 999, { fps: 240 }), null);
  assert.deepEqual(jumpResult(times, 50, 50, { fps: 240 }), { error: 'order' });
  assert.deepEqual(jumpResult(times, 60, 50, { fps: 240 }), { error: 'order' });
  assert.equal(jumpResult(times, 0, 24, { fps: 240 }).warning, 'short'); // 0.1 s
  assert.equal(jumpResult(times, 0, 24, { fps: 240 }).frames, 24);
});

test('addAttempt fills empty slots, then replaces the lowest if better', () => {
  assert.deepEqual(addAttempt(undefined, 60, 3), { attempts: [60, null, null], index: 0, replaced: null });
  assert.deepEqual(addAttempt([58, null, 61], 60, 3), { attempts: [58, 60, 61], index: 1, replaced: null });
  assert.deepEqual(addAttempt([58, 62, 61], 60, 3), { attempts: [60, 62, 61], index: 0, replaced: 58 });
  assert.deepEqual(addAttempt([58, 62, 61], 57, 3), { attempts: [58, 62, 61], index: null, replaced: null });
});
