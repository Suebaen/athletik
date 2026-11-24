// Pure aggregation of logs for the history and tests screens.

/** Best (max) numeric attempt, or null. */
export function bestAttempt(attempts) {
  const nums = (attempts ?? []).filter((a) => typeof a === 'number' && Number.isFinite(a));
  return nums.length ? Math.max(...nums) : null;
}

/** [{date, best}] for one test, sorted by date, skipping empty results. */
export function testSeries(testRecords, testId) {
  return testRecords
    .filter((r) => r.testId === testId && r.best != null)
    .map((r) => ({ date: r.date, best: r.best }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Top set per session (date) for one exercise.
 * Weighted exercises: highest weight (ties → more reps). Others: most reps
 * or seconds. Returns [{date, value, top, sets}] sorted by date ascending;
 * `value` is null if no set of that day has a comparable number.
 */
export function topSetsByDate(records, { trackWeight }) {
  const byDate = new Map();
  for (const r of records) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const amount = (r) => r.reps ?? r.seconds ?? null;
  const out = [];
  for (const [date, sets] of byDate) {
    sets.sort((a, b) => a.setNo - b.setNo);
    let top = null;
    for (const s of sets) {
      if (trackWeight) {
        if (s.weightKg == null) continue;
        if (!top || s.weightKg > top.weightKg || (s.weightKg === top.weightKg && (amount(s) ?? 0) > (amount(top) ?? 0))) top = s;
      } else {
        if (amount(s) == null) continue;
        if (!top || amount(s) > amount(top)) top = s;
      }
    }
    const value = top ? (trackWeight ? top.weightKg : amount(top)) : null;
    out.push({ date, value, top, sets });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}
