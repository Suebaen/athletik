// Pure helpers for parsing and formatting user input (German number format).

/** Parses "62,5" / "62.5" into 62.5. Empty or invalid input → null. Negative → null. */
export function parseDecimal(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(',', '.');
  if (s === '') return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Parses a non-negative integer. Empty or invalid input → null. */
export function parseIntOrNull(str) {
  if (str == null) return null;
  const s = String(str).trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}

/** 62.5 → "62,5". null → "". */
export function formatDecimal(n) {
  if (n == null || !Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

/** Short text for one logged set: "8 × 60 kg", "20 s", "8 Wdh.", "60 kg". */
export function formatSet(rec) {
  const amount = rec.seconds != null ? `${rec.seconds} s` : rec.reps != null ? String(rec.reps) : null;
  const kg = rec.weightKg != null ? `${formatDecimal(rec.weightKg)} kg` : null;
  if (amount && kg) return `${amount} × ${kg}`;
  if (kg) return kg;
  if (rec.seconds != null) return amount;
  if (amount) return `${amount} Wdh.`;
  return rec.done ? '✓' : '–';
}
