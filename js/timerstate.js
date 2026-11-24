// Pure rest-timer math. The timer is defined only by timestamps (ms since
// epoch), so it stays correct while the app is suspended in the background.

/** New timer state. `info` carries display data (exerciseId, exerciseName). */
export function startTimer(seconds, now, info = {}) {
  const durationMs = Math.max(0, seconds) * 1000;
  return { ...info, durationMs, startedAt: now, endsAt: now + durationMs };
}

export function remainingMs(state, now) {
  return Math.max(0, state.endsAt - now);
}

export function isFinished(state, now) {
  return now >= state.endsAt;
}

/** Fraction of the rest period still remaining (1 → 0). */
export function remainingFraction(state, now) {
  if (!state.durationMs) return 0;
  return Math.min(1, Math.max(0, remainingMs(state, now) / state.durationMs));
}

/** Adds (or with negative delta removes) time. Never ends before `now`. */
export function adjustTimer(state, deltaMs, now) {
  const endsAt = Math.max(now, state.endsAt + deltaMs);
  const durationMs = Math.max(1000, state.durationMs + (endsAt - state.endsAt));
  return { ...state, endsAt, durationMs };
}

/**
 * What to do with a persisted timer when the app starts again:
 * 'running' – still counting down, 'finished' – ended recently (show "done"),
 * 'discard' – ended long ago.
 */
export function restoreAction(state, now, staleMs = 2 * 60 * 1000) {
  if (!state || typeof state.endsAt !== 'number') return 'discard';
  if (now < state.endsAt) return 'running';
  return now - state.endsAt <= staleMs ? 'finished' : 'discard';
}
