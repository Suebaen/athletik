import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightTimeToHeight, heightToFlightTime, heightErrorPerFrame, estimateFps, rateFps, frameAt, frameSeekTime } from '../js/jump.js';

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

test('frame stepping lands on consecutive frames', () => {
  for (const fps of [240, 30, 29.97]) {
    let t = 0;
    const seen = [];
    for (let i = 0; i < 5; i++) {
      t = frameSeekTime(frameAt(t, fps) + 1, fps);
      seen.push(frameAt(t, fps));
    }
    assert.deepEqual(seen, [1, 2, 3, 4, 5], `fps ${fps}`);
    assert.equal(frameAt(frameSeekTime(4, fps) - 0.5 / fps, fps), 4); // exact frame start
  }
  assert.equal(frameAt(-1, 240), 0);
});
