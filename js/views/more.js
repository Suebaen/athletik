// "Mehr": backup export/import, plan import, app info.

import { formatDateDE, toDateString, sortedPhases, phaseEndDate, formatShortDE } from '../plan.js';
import { el, toast } from '../ui.js';
import { validateBackup, validatePlan, buildBackup, mergeRecords, fingerprint } from '../validate.js';
import * as db from '../db.js';

export async function renderMore(ctx) {
  const [setCount, testCount, lastExport, imported, persisted, version] = await Promise.all([
    db.getAll('sets').then((a) => a.length),
    db.getAll('tests').then((a) => a.length),
    db.getMeta('lastExport'),
    db.getMeta('importedPlan'),
    navigator.storage?.persisted?.().catch(() => false) ?? false,
    appVersion(),
  ]);

  return el('div', { class: 'more' },
    el('h1', { text: 'Mehr' }),
    backupSection(ctx, setCount, testCount, lastExport),
    planSection(ctx, imported),
    el('section', { class: 'card' },
      el('h2', { text: 'App' }),
      el('ul', { class: 'plain-list' },
        el('li', {}, 'Version: ', el('strong', { text: version ?? 'ohne Offline-Cache' })),
        el('li', {}, 'Gespeichert: ', el('strong', { text: `${setCount} Sätze, ${testCount} Testergebnisse` })),
        el('li', {}, 'Dauerhafter Speicher: ', el('strong', { text: persisted ? 'ja' : 'nicht bestätigt' }))),
      !persisted && el('p', { class: 'muted small', text: 'Safari kann Daten von Web-Apps löschen, die lange nicht geöffnet wurden. Regelmäßig eine Sicherung exportieren.' })));
}

async function appVersion() {
  try {
    const keys = await caches.keys();
    const key = keys.find((k) => k.startsWith('athletik-'));
    return key ? key.slice('athletik-'.length) : null;
  } catch {
    return null;
  }
}

/** Hidden <input type=file> + button. Calls onText(text, file). */
function filePicker(label, onText, cls = 'btn secondary block') {
  // No `accept` filter: iOS sometimes greys out .json files otherwise.
  const input = el('input', { type: 'file', hidden: true });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await onText(await file.text(), file);
    } catch (err) {
      console.error(err);
      toast('Datei konnte nicht gelesen werden');
    }
  });
  return [el('button', { type: 'button', class: cls, text: label, onclick: () => input.click() }), input];
}

function parseJson(text) {
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: 'Die Datei ist kein gültiges JSON.' };
  }
}

function errorBox(title, errors) {
  return el('div', { class: 'notice error' },
    el('strong', { text: title }),
    el('ul', {}, errors.map((e) => el('li', { text: e }))));
}

// ---------------------------------------------------------------------------
// Backup

function backupSection(ctx, setCount, testCount, lastExport) {
  const preview = el('div');
  const daysSince = lastExport ? Math.floor((Date.now() - lastExport) / 86400000) : null;

  const [importBtn, importInput] = filePicker('Sicherung importieren', async (text) => {
    const { data, error } = parseJson(text);
    if (error) { preview.replaceChildren(errorBox('Import nicht möglich', [error])); return; }
    const res = validateBackup(data);
    if (!res.ok) { preview.replaceChildren(errorBox('Die Sicherung ist ungültig', res.errors)); return; }
    preview.replaceChildren(importPreview(ctx, data, res, preview));
  });

  return el('section', { class: 'card' },
    el('h2', { text: 'Datensicherung' }),
    el('p', { class: 'muted', text: lastExport
      ? `Letzte Sicherung: ${formatDateDE(toDateString(new Date(lastExport)))}${daysSince > 0 ? ` (vor ${daysSince} Tagen)` : ''}`
      : 'Noch keine Sicherung exportiert.' }),
    daysSince != null && daysSince >= 14 && el('p', { class: 'notice warn', text: 'Zeit für eine neue Sicherung.' }),
    el('button', {
      type: 'button', class: 'btn block', text: 'Sicherung exportieren',
      disabled: setCount + testCount === 0,
      onclick: () => exportBackup().catch((err) => { console.error(err); toast('Export fehlgeschlagen'); }),
    }),
    importBtn, importInput, preview);
}

async function exportBackup() {
  const [sets, tests] = await Promise.all([db.getAll('sets'), db.getAll('tests')]);
  const json = JSON.stringify(buildBackup(sets, tests), null, 1);
  const name = `athletik-backup-${toDateString()}.json`;
  const file = new File([json], name, { type: 'application/json' });

  let done = false;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Athletik-Sicherung' });
      done = true;
    } catch (err) {
      if (err?.name === 'AbortError') return; // user closed the share sheet
      console.warn('Share failed, falling back to download', err);
    }
  }
  if (!done) {
    const url = URL.createObjectURL(file);
    const a = el('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  await db.setMeta('lastExport', Date.now());
  toast('Sicherung erstellt');
}

function importPreview(ctx, data, res, container) {
  const dates = [...res.sets, ...res.tests].map((r) => r.date).sort();
  const range = dates.length ? `${formatShortDE(dates[0])}${dates[0].slice(0, 4)} – ${formatShortDE(dates.at(-1))}${dates.at(-1).slice(0, 4)}` : 'leer';

  const run = async (mode) => {
    if (mode === 'replace' && !confirm('Alle vorhandenen Einträge werden gelöscht und durch die Sicherung ersetzt. Fortfahren?')) return;
    try {
      if (mode === 'replace') {
        await db.replaceAll({ sets: res.sets, tests: res.tests });
        toast(`Ersetzt: ${res.sets.length} Sätze, ${res.tests.length} Tests`);
      } else {
        const [curSets, curTests] = await Promise.all([db.getAll('sets'), db.getAll('tests')]);
        const ms = mergeRecords(curSets, res.sets);
        const mt = mergeRecords(curTests, res.tests);
        await db.putMany('sets', ms.toWrite);
        await db.putMany('tests', mt.toWrite);
        toast(`Zusammengeführt: ${ms.added + mt.added} neu, ${ms.updated + mt.updated} aktualisiert`);
      }
      container.replaceChildren();
      ctx.rerender();
    } catch (err) {
      console.error(err);
      toast('Import fehlgeschlagen');
    }
  };

  return el('div', { class: 'notice' },
    el('strong', { text: 'Sicherung gefunden' }),
    el('p', { text: `${res.sets.length} Sätze, ${res.tests.length} Testergebnisse (${range})` }),
    data.exportedAt && el('p', { class: 'muted small', text: `Exportiert: ${new Date(data.exportedAt).toLocaleString('de-DE')}` }),
    el('p', { class: 'muted small', text: 'Zusammenführen behält bei gleichen Einträgen jeweils den neueren. Ersetzen löscht zuerst alles.' }),
    el('div', { class: 'btn-row' },
      el('button', { type: 'button', class: 'btn', text: 'Zusammenführen', onclick: () => run('merge') }),
      el('button', { type: 'button', class: 'btn danger', text: 'Ersetzen', onclick: () => run('replace') }),
      el('button', { type: 'button', class: 'btn secondary', text: 'Abbrechen', onclick: () => container.replaceChildren() })));
}

// ---------------------------------------------------------------------------
// Plan

function planSummary(plan) {
  const phases = sortedPhases(plan);
  const first = phases[0];
  const last = phases.at(-1);
  const end = last ? phaseEndDate(last) : null;
  return `${phases.length} Phasen, ${first ? formatDateDE(first.startDate) : '?'} bis ${end ? formatDateDE(end) : 'offen'}`;
}

function planSection(ctx, imported) {
  const preview = el('div');
  const bundledText = ctx.bundledPlan ? JSON.stringify(ctx.bundledPlan) : null;
  const bundledChanged = imported && bundledText && imported.bundledFingerprint !== fingerprint(bundledText);

  const [importBtn, importInput] = filePicker('Neuen Plan importieren', async (text, file) => {
    const { data, error } = parseJson(text);
    if (error) { preview.replaceChildren(errorBox('Import nicht möglich', [error])); return; }
    const res = validatePlan(data);
    if (!res.ok) { preview.replaceChildren(errorBox('Der Plan ist ungültig', res.errors)); return; }
    preview.replaceChildren(el('div', { class: 'notice' },
      el('strong', { text: data.title }),
      el('p', { text: planSummary(data) }),
      el('p', { class: 'muted small', text: 'Alle Einträge bleiben erhalten – sie hängen an Übungs-IDs und Datum, nicht am Plan.' }),
      el('div', { class: 'btn-row' },
        el('button', {
          type: 'button', class: 'btn', text: 'Plan übernehmen',
          onclick: async () => {
            await db.setMeta('importedPlan', {
              plan: data, fileName: file.name, importedAt: Date.now(),
              bundledFingerprint: bundledText ? fingerprint(bundledText) : null,
            });
            toast('Plan übernommen');
            await ctx.reloadPlan();
          },
        }),
        el('button', { type: 'button', class: 'btn secondary', text: 'Abbrechen', onclick: () => preview.replaceChildren() }))));
  });

  return el('section', { class: 'card' },
    el('h2', { text: 'Trainingsplan' }),
    el('p', {}, el('strong', { text: ctx.plan.title })),
    el('p', { class: 'muted', text: planSummary(ctx.plan) }),
    el('p', { class: 'muted small', text: imported
      ? `Importiert am ${formatDateDE(toDateString(new Date(imported.importedAt)))}${imported.fileName ? ` (${imported.fileName})` : ''}`
      : 'Mitgelieferter Plan' }),
    bundledChanged && el('p', { class: 'notice warn', text: 'Mit dem letzten App-Update kam ein geänderter mitgelieferter Plan. Er wird erst verwendet, wenn du unten auf „Mitgelieferten Plan verwenden“ tippst.' }),
    importBtn, importInput,
    imported && el('button', {
      type: 'button', class: 'btn secondary block', text: 'Mitgelieferten Plan verwenden',
      onclick: async () => {
        if (!ctx.bundledPlan) { toast('Mitgelieferter Plan nicht verfügbar'); return; }
        if (!confirm('Importierten Plan verwerfen und den mitgelieferten verwenden? Einträge bleiben erhalten.')) return;
        await db.deleteMeta('importedPlan');
        toast('Mitgelieferter Plan aktiv');
        await ctx.reloadPlan();
      },
    }),
    preview);
}
