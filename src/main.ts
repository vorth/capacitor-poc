import './style.css';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { Clipboard } from '@capacitor/clipboard';
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerTypeHint,
} from '@capacitor/barcode-scanner';
import {
  getStore,
  MAX_CODE_LENGTH,
  type Reading,
  type ReadingDetails,
  type ReadingsStore,
} from './db';
import { Printer } from './printer';
import { FileSaver } from './fileSaver';
import type { ReverseGeocoder } from './geocoder';
import { NominatimGeocoder } from './nominatim';
import { exportFilename, formatReading, toCSV, toJSON, type ExportFormat } from './export';

const STALE_FIX_MS = 3000;
// Hysteresis: turn green at GOOD_ACCURACY_M or better, but only drop back to
// amber once accuracy is worse than POOR_ACCURACY_M.
const GOOD_ACCURACY_M = 40;
const POOR_ACCURACY_M = 50;

// Error code the barcode scanner rejects with when the user cancels.
const SCAN_CANCELLED = 'OS-PLUG-BARC-0006';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header class="toolbar">
    <button id="select-btn" type="button" class="text-btn">Select</button>
  </header>
  <main class="card">
    <ol id="history-list" class="history-list"></ol>
  </main>
  <div id="action-bar" class="action-bar" hidden>
    <div class="action-group">
      <button id="labels-btn" type="button" class="text-btn" disabled>Labels</button>
      <button id="copy-btn" type="button" class="icon-btn" aria-label="Copy selected readings" disabled>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      </button>
      <button id="download-btn" type="button" class="icon-btn" aria-label="Download selected readings" disabled>
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
    </div>
    <button id="delete-btn" type="button" class="icon-btn" aria-label="Delete selected readings" disabled>
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  </div>
  <button id="fix-btn" type="button" class="no-fix" aria-label="Scan QR code and record location fix">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="16" y="3" width="5" height="5" rx="1" />
      <rect x="3" y="16" width="5" height="5" rx="1" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M12 7v3a2 2 0 0 1-2 2H7" />
      <path d="M21 21v.01M3 12h.01M12 3h.01M12 16v.01M16 12h1M21 12v.01M12 21v-1" />
    </svg>
    <svg class="icon icon-filled" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  </button>
  <dialog id="inspector" class="inspector" aria-labelledby="inspector-title">
    <h2 id="inspector-title" class="split-title"><span id="inspector-code" class="code"></span><span id="inspector-taxon"></span></h2>
    <dl class="result">
      <div><dt>Time</dt><dd id="time-value">—</dd></div>
      <div><dt>Date</dt><dd id="date-value">—</dd></div>
      <div><dt>Region</dt><dd id="region-value">—</dd></div>
      <div><dt>Locality</dt><dd id="locality-value">—</dd></div>
      <div><dt>Latitude</dt><dd id="lat">—</dd></div>
      <div><dt>Longitude</dt><dd id="lng">—</dd></div>
      <div><dt>Accuracy</dt><dd id="acc">—</dd></div>
      <div><dt>Altitude</dt><dd id="alt">—</dd></div>
      <div><dt>Collector</dt><dd id="collector-value">—</dd></div>
    </dl>
    <form method="dialog">
      <button type="submit" class="close-btn">Close</button>
    </form>
  </dialog>
  <dialog id="details" class="inspector details" aria-labelledby="details-title">
    <h2 id="details-title">ID<span id="details-code" class="code"></span></h2>
    <form method="dialog" class="details-form">
      <label>
        Locality
        <input id="locality" type="text" autocapitalize="sentences" enterkeyhint="next" />
        <input id="locality2" type="text" autocapitalize="sentences" enterkeyhint="next"
          aria-label="Locality, second line" />
      </label>
      <label>
        Taxon
        <input id="taxon" type="text" autocapitalize="sentences" autocorrect="off"
          spellcheck="false" enterkeyhint="next" />
      </label>
      <label>
        Collector
        <input id="collector" type="text" autocapitalize="words" autocorrect="off"
          spellcheck="false" enterkeyhint="done" />
      </label>
      <div class="dialog-actions">
        <button type="submit" value="discard" class="secondary-btn">Discard</button>
        <button type="submit" value="save">Save</button>
      </div>
    </form>
  </dialog>
  <dialog id="labels" class="sheet" aria-labelledby="labels-title">
    <header class="sheet-bar">
      <button id="labels-done" type="button" class="text-btn">Done</button>
      <h2 id="labels-title">Labels</h2>
      <button id="labels-print" type="button" class="text-btn">Print</button>
    </header>
    <div class="sheet-body">
      <div id="labels-status" class="labels-status" hidden>
        <p id="labels-message"></p>
        <div id="labels-failed" class="dialog-actions" hidden>
          <button id="labels-cancel" type="button" class="secondary-btn">Cancel</button>
          <button id="labels-retry" type="button" class="secondary-btn">Retry</button>
          <button id="labels-continue" type="button">Continue anyway</button>
        </div>
      </div>
      <div id="labels-content">
        <p class="sheet-note">Shown at twice actual size.</p>
        <div class="label-paper">
          <div id="label-preview" class="label-output"></div>
        </div>
      </div>
    </div>
  </dialog>
  <dialog id="export-menu" class="inspector" aria-labelledby="export-title">
    <h2 id="export-title"></h2>
    <form method="dialog">
      <div class="segmented" role="radiogroup" aria-label="Format">
        <label><input type="radio" name="export-format" value="json" /><span>JSON</span></label>
        <label><input type="radio" name="export-format" value="csv" /><span>CSV</span></label>
      </div>
      <div class="dialog-actions">
        <button type="submit" value="cancel" class="secondary-btn">Cancel</button>
        <button id="export-submit" type="submit" value="export"></button>
      </div>
    </form>
  </dialog>
  <dialog id="export-status" class="inspector" aria-labelledby="export-message">
    <p id="export-message" class="export-message"></p>
    <div class="dialog-actions">
      <button id="export-cancel" type="button" class="secondary-btn">Cancel</button>
      <button id="export-retry" type="button" class="secondary-btn" hidden>Retry</button>
      <button id="export-continue" type="button" hidden>Continue anyway</button>
    </div>
  </dialog>
  <dialog id="confirm-delete" class="inspector" aria-labelledby="confirm-title">
    <h2 id="confirm-title"></h2>
    <p class="confirm-note">This can't be undone.</p>
    <form method="dialog" class="dialog-actions">
      <button type="submit" value="cancel" class="secondary-btn">Cancel</button>
      <button type="submit" value="delete" class="danger-btn">Delete</button>
    </form>
  </dialog>
`;

const btn = document.querySelector<HTMLButtonElement>('#fix-btn')!;
const historyEl = document.querySelector<HTMLOListElement>('#history-list')!;
const inspectorEl = document.querySelector<HTMLDialogElement>('#inspector')!;
const selectBtn = document.querySelector<HTMLButtonElement>('#select-btn')!;
const actionBar = document.querySelector<HTMLDivElement>('#action-bar')!;
const deleteBtn = document.querySelector<HTMLButtonElement>('#delete-btn')!;
const confirmEl = document.querySelector<HTMLDialogElement>('#confirm-delete')!;
const detailsEl = document.querySelector<HTMLDialogElement>('#details')!;
const localityInput = document.querySelector<HTMLInputElement>('#locality')!;
const locality2Input = document.querySelector<HTMLInputElement>('#locality2')!;
const taxonInput = document.querySelector<HTMLInputElement>('#taxon')!;
const collectorInput = document.querySelector<HTMLInputElement>('#collector')!;
const labelsBtn = document.querySelector<HTMLButtonElement>('#labels-btn')!;
const labelsEl = document.querySelector<HTMLDialogElement>('#labels')!;
const labelsDoneBtn = document.querySelector<HTMLButtonElement>('#labels-done')!;
const labelsPrintBtn = document.querySelector<HTMLButtonElement>('#labels-print')!;
const labelPreview = document.querySelector<HTMLDivElement>('#label-preview')!;
const labelsStatus = document.querySelector<HTMLDivElement>('#labels-status')!;
const labelsFailed = document.querySelector<HTMLDivElement>('#labels-failed')!;
const labelsContent = document.querySelector<HTMLDivElement>('#labels-content')!;
const labelsCancelBtn = document.querySelector<HTMLButtonElement>('#labels-cancel')!;
const labelsRetryBtn = document.querySelector<HTMLButtonElement>('#labels-retry')!;
const labelsContinueBtn = document.querySelector<HTMLButtonElement>('#labels-continue')!;
const copyBtn = document.querySelector<HTMLButtonElement>('#copy-btn')!;
const downloadBtn = document.querySelector<HTMLButtonElement>('#download-btn')!;
const exportMenuEl = document.querySelector<HTMLDialogElement>('#export-menu')!;
const exportStatusEl = document.querySelector<HTMLDialogElement>('#export-status')!;
const exportCancelBtn = document.querySelector<HTMLButtonElement>('#export-cancel')!;
const exportRetryBtn = document.querySelector<HTMLButtonElement>('#export-retry')!;
const exportContinueBtn = document.querySelector<HTMLButtonElement>('#export-continue')!;

// What gets printed: a copy of the labels outside #app, shown only by the
// print stylesheet (which hides #app, and with it the open labels sheet).
const labelPrintEl = document.createElement('div');
labelPrintEl.className = 'label-output print-only';
document.body.append(labelPrintEl);

let store: ReadingsStore | null = null;

// All readings, as last loaded into the list.
let readings: Reading[] = [];

// Most recent position from the location watch; null when we have no usable fix.
let currentFix: Position | null = null;

// Region lookups run only on demand: when a reading is inspected, and for
// labels. See dev-docs/reverse-geocoding.md.
const geocoder: ReverseGeocoder = new NominatimGeocoder();

// Look up a reading's place and save it. Resolves with the updated reading,
// which also replaces the old one in `readings`.
async function resolvePlace(r: Reading): Promise<Reading> {
  const place = await geocoder.lookup(r.latitude, r.longitude);
  if (!store) throw new Error('storage unavailable');
  await store.setPlace(r.id, place);
  const updated: Reading = {
    ...r,
    region: place.region,
    place: { source: place.source, details: place.details },
  };
  const i = readings.findIndex((x) => x.id === r.id);
  if (i >= 0) readings[i] = updated;
  return updated;
}

const set = (id: string, value: string) => {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = value;
};

// The reading shown in the inspector, so a region that arrives after the
// inspector has closed (or moved on) isn't shown on the wrong reading.
let inspectedId: number | null = null;

function inspect(r: Reading) {
  const { date, time } = formatReading(r);
  inspectedId = r.id;
  set('inspector-code', r.code);
  set('inspector-taxon', r.taxon ?? '');
  set('time-value', time);
  set('date-value', date);
  if (r.place) {
    set('region-value', r.region ?? '—');
  } else {
    set('region-value', 'Looking up…');
    resolvePlace(r).then(
      (u) => {
        if (inspectedId === u.id) set('region-value', u.region ?? '—');
      },
      () => {
        if (inspectedId === r.id) set('region-value', '—');
      },
    );
  }
  // Both locality lines in one cell, one per line.
  const localityLines = [r.locality, r.locality2].filter((line) => line != null);
  const localityEl = document.querySelector<HTMLElement>('#locality-value')!;
  localityEl.replaceChildren();
  localityLines.forEach((line, i) => {
    if (i > 0) localityEl.append(document.createElement('br'));
    localityEl.append(line);
  });
  if (localityLines.length === 0) localityEl.textContent = '—';
  set('collector-value', r.collector ?? '—');
  set('lat', r.latitude.toFixed(5) + '°');
  set('lng', r.longitude.toFixed(5) + '°');
  set('acc', `± ${r.accuracy.toFixed(0)} m`);
  set('alt', r.altitude != null ? `${r.altitude.toFixed(0)} m` : 'n/a');
  inspectorEl.showModal();
}

inspectorEl.addEventListener('close', () => {
  inspectedId = null;
});

// Selection mode: rows toggle selection instead of opening the inspector,
// and the capture button is replaced by the action bar.
let selecting = false;
const selected = new Set<number>();

function renderSelection() {
  app.classList.toggle('selecting', selecting);
  selectBtn.textContent = selecting ? 'Cancel' : 'Select';
  selectBtn.disabled = !selecting && historyEl.childElementCount === 0;
  actionBar.hidden = !selecting;
  btn.hidden = selecting;
  deleteBtn.disabled = selected.size === 0;
  labelsBtn.disabled = selected.size === 0;
  copyBtn.disabled = selected.size === 0;
  downloadBtn.disabled = selected.size === 0;
  for (const item of historyEl.querySelectorAll<HTMLButtonElement>('.reading')) {
    const isSelected = selected.has(Number(item.dataset.id));
    item.classList.toggle('selected', isSelected);
    if (selecting) item.setAttribute('aria-pressed', String(isSelected));
    else item.removeAttribute('aria-pressed');
  }
}

function setSelecting(on: boolean) {
  selecting = on;
  selected.clear();
  renderSelection();
}

function onReadingTap(id: number) {
  // Look the reading up again: a region lookup may have replaced it.
  const r = readings.find((x) => x.id === id);
  if (!r) return;
  if (!selecting) {
    inspect(r);
    return;
  }
  if (selected.has(r.id)) selected.delete(r.id);
  else selected.add(r.id);
  renderSelection();
}

async function refreshHistory() {
  if (!store) return;
  const count = await store.getReadingCount();
  readings = await store.getReadings(count);
  historyEl.replaceChildren(
    ...readings.map((r) => {
      const li = document.createElement('li');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'reading';
      item.dataset.id = String(r.id);
      const check = document.createElement('span');
      check.className = 'check';
      check.setAttribute('aria-hidden', 'true');
      const codeEl = document.createElement('span');
      codeEl.className = 'code';
      codeEl.textContent = r.code;
      const taxonEl = document.createElement('span');
      taxonEl.className = 'taxon';
      taxonEl.textContent = r.taxon ?? '';
      item.append(check, codeEl, taxonEl);
      item.addEventListener('click', () => onReadingTap(r.id));
      li.append(item);
      return li;
    }),
  );
  renderSelection();
}

selectBtn.addEventListener('click', () => setSelecting(!selecting));

deleteBtn.addEventListener('click', () => {
  const n = selected.size;
  set('confirm-title', `Delete ${n} reading${n === 1 ? '' : 's'}?`);
  confirmEl.returnValue = '';
  confirmEl.showModal();
});

confirmEl.addEventListener('close', async () => {
  if (confirmEl.returnValue !== 'delete' || !store) return;
  try {
    await store.deleteReadings([...selected]);
    setSelecting(false);
    await refreshHistory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Readings not deleted: ${msg}`);
  }
});

// One specimen label per reading, styled after the old app's labels: a
// locality block (ending with the collector), the taxon (if any), and the ID
// in large type.
function labelFor(r: Reading): HTMLElement {
  const { date, time } = formatReading(r);
  const span = (text: string, className?: string) => {
    const el = document.createElement('span');
    el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const block = (className: string, lines: HTMLElement[]) => {
    const div = document.createElement('div');
    div.className = className;
    div.append(...lines);
    return div;
  };
  const label = document.createElement('div');
  label.className = 'single-label';
  // The time follows the date on the same row, set off by a fixed gap.
  const dateTime = span(date);
  dateTime.append(span(time, 'label-time'));
  const locality = [
    r.region ? span(r.region) : null,
    r.locality ? span(r.locality) : null,
    r.locality2 ? span(r.locality2) : null,
    span(`${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)} ±${r.accuracy.toFixed(0)}m`),
    dateTime,
    r.altitude != null ? span(`elev. ${r.altitude.toFixed(0)}m`) : null,
    r.collector ? span(r.collector) : null,
  ];
  label.append(block('label-locality', locality.filter((el) => el != null)));
  if (r.taxon) label.append(block('label-notes', [span(r.taxon)]));
  label.append(block('label-taxonomy', [span(r.code, 'label-id')]));
  return label;
}

// The selected readings, oldest first.
function selectedReadings(): Reading[] {
  return readings
    .filter((r) => selected.has(r.id))
    .sort((a, b) => a.recordedAt - b.recordedAt);
}

function renderLabels() {
  const chosen = selectedReadings();
  labelPreview.replaceChildren(...chosen.map(labelFor));
  labelPrintEl.replaceChildren(...chosen.map(labelFor));
  labelsStatus.hidden = true;
  labelsContent.hidden = false;
  labelsPrintBtn.disabled = false;
}

// Either the labels, or a message (with the failure buttons when `failed`).
function showLabelsStatus(message: string, failed = false) {
  set('labels-message', message);
  labelsFailed.hidden = !failed;
  labelsStatus.hidden = false;
  labelsContent.hidden = true;
  labelsPrintBtn.disabled = true;
}

// Look up places for the readings that lack one, calling `progress` with a
// status message before the first lookup and as each one settles. Resolves
// with a failure message, or null when every reading has a place.
async function lookUpPlaces(rs: Reading[], progress: (message: string) => void): Promise<string | null> {
  const pending = rs.filter((r) => r.place == null);
  if (pending.length === 0) return null;
  let settled = 0;
  const report = () => progress(`Reverse geocoding… ${settled} of ${pending.length}`);
  report();
  const results = await Promise.allSettled(
    pending.map((r) =>
      resolvePlace(r).finally(() => {
        settled++;
        report();
      }),
    ),
  );
  const failed = results.filter((res) => res.status === 'rejected').length;
  if (failed === 0) return null;
  return `Couldn't look up the region for ${failed} of ${pending.length} reading${pending.length === 1 ? '' : 's'}.`;
}

// Each opening of the sheet (and each retry) is a new run; lookups from an
// earlier run still save their results but no longer update the sheet.
let labelsRun = 0;

// Look up regions for the selected readings that lack one, then show the labels.
async function prepareLabels() {
  const run = ++labelsRun;
  const failure = await lookUpPlaces(selectedReadings(), (message) => {
    if (run === labelsRun) showLabelsStatus(message);
  });
  if (run !== labelsRun) return;
  if (failure) showLabelsStatus(failure, true);
  else renderLabels();
}

labelsBtn.addEventListener('click', () => {
  labelsEl.querySelector('.sheet-body')!.scrollTop = 0;
  labelsEl.showModal();
  prepareLabels();
});

// Slide the sheet out, then close it.
function closeLabels() {
  labelsEl.classList.add('closing');
  const done = () => {
    labelsEl.classList.remove('closing');
    labelsEl.close();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else labelsEl.addEventListener('animationend', done, { once: true });
}

labelsDoneBtn.addEventListener('click', closeLabels);
labelsCancelBtn.addEventListener('click', closeLabels);
labelsRetryBtn.addEventListener('click', prepareLabels);

// Also covers closing by other means, such as Android's back button.
labelsEl.addEventListener('close', () => {
  labelsRun++;
});

async function printLabels() {
  labelsPrintBtn.disabled = true;
  try {
    await Printer.printWebView({ jobName: 'Specimen Labels' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Labels not printed: ${msg}`);
  } finally {
    labelsPrintBtn.disabled = false;
  }
}

labelsPrintBtn.addEventListener('click', printLabels);

// Show the labels, without a region on the readings that failed, and print.
labelsContinueBtn.addEventListener('click', () => {
  labelsRun++;
  renderLabels();
  printLabels();
});

// Copy and Download: choose JSON or CSV (each action preselects its own last
// choice), look up any missing regions as for labels, then put the selected
// readings on the clipboard or save them to a file.
type ExportAction = 'copy' | 'download';

const EXPORT_ACTIONS: Record<ExportAction, { verb: string; formatKey: string }> = {
  copy: { verb: 'Copy', formatKey: 'copyFormat' },
  download: { verb: 'Download', formatKey: 'downloadFormat' },
};

function loadExportFormat(action: ExportAction): ExportFormat {
  try {
    return localStorage.getItem(EXPORT_ACTIONS[action].formatKey) === 'csv' ? 'csv' : 'json';
  } catch {
    return 'json';
  }
}

function saveExportFormat(action: ExportAction, format: ExportFormat) {
  try {
    localStorage.setItem(EXPORT_ACTIONS[action].formatKey, format);
  } catch {
    // Not worth bothering the user about.
  }
}

// The export being set up or run.
let exportAction: ExportAction = 'copy';
let exportFormat: ExportFormat = 'json';

function openExportMenu(action: ExportAction) {
  exportAction = action;
  const n = selected.size;
  const { verb } = EXPORT_ACTIONS[action];
  set('export-title', `${verb} ${n} reading${n === 1 ? '' : 's'} as`);
  set('export-submit', verb);
  const format = loadExportFormat(action);
  exportMenuEl.querySelector<HTMLInputElement>(`input[value="${format}"]`)!.checked = true;
  exportMenuEl.returnValue = '';
  exportMenuEl.showModal();
}

copyBtn.addEventListener('click', () => openExportMenu('copy'));
downloadBtn.addEventListener('click', () => openExportMenu('download'));

exportMenuEl.addEventListener('close', () => {
  if (exportMenuEl.returnValue !== 'export') return;
  const checked = exportMenuEl.querySelector<HTMLInputElement>('input[name="export-format"]:checked');
  exportFormat = checked?.value === 'csv' ? 'csv' : 'json';
  saveExportFormat(exportAction, exportFormat);
  prepareExport();
});

// Runs work as for labels: closing the status dialog makes earlier lookups stale.
let exportRun = 0;

function showExportStatus(message: string, failed = false) {
  set('export-message', message);
  exportRetryBtn.hidden = !failed;
  exportContinueBtn.hidden = !failed;
  if (!exportStatusEl.open) exportStatusEl.showModal();
}

async function prepareExport() {
  const run = ++exportRun;
  const failure = await lookUpPlaces(selectedReadings(), (message) => {
    if (run === exportRun) showExportStatus(message);
  });
  if (run !== exportRun) return;
  if (failure) {
    showExportStatus(failure, true);
    return;
  }
  exportStatusEl.close();
  exportReadings();
}

async function exportReadings() {
  const chosen = selectedReadings();
  const format = exportFormat;
  const text = format === 'csv' ? toCSV(chosen) : toJSON(chosen);
  const n = chosen.length;
  const what = `${n} reading${n === 1 ? '' : 's'} as ${format.toUpperCase()}`;
  try {
    if (exportAction === 'copy') {
      await Clipboard.write({ string: text });
      showToast(`Copied ${what}`);
    } else {
      const { saved } = await FileSaver.saveFile({
        filename: exportFilename(format),
        contents: text,
        mimeType: format === 'csv' ? 'text/csv' : 'application/json',
      });
      if (saved) showToast(`Saved ${what}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Readings not ${exportAction === 'copy' ? 'copied' : 'saved'}: ${msg}`);
  }
}

exportCancelBtn.addEventListener('click', () => exportStatusEl.close());
exportRetryBtn.addEventListener('click', prepareExport);
exportContinueBtn.addEventListener('click', () => {
  exportStatusEl.close();
  exportReadings();
});

// Also covers closing by other means, such as Android's back button.
exportStatusEl.addEventListener('close', () => {
  exportRun++;
});

// A brief confirmation at the bottom of the screen.
const toastEl = document.createElement('div');
toastEl.className = 'toast';
toastEl.setAttribute('role', 'status');
document.body.append(toastEl);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(message: string) {
  toastEl.textContent = message;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 2000);
}

// Tapping the backdrop (outside the dialog box) closes a dialog.
for (const dialog of [inspectorEl, confirmEl, exportMenuEl]) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

let fixIsGood = false;

// Amber when there's no fix; otherwise green/amber per the accuracy thresholds.
function render() {
  if (currentFix == null) {
    fixIsGood = false;
  } else {
    const limit = fixIsGood ? POOR_ACCURACY_M : GOOD_ACCURACY_M;
    fixIsGood = currentFix.coords.accuracy <= limit;
  }
  btn.classList.toggle('good-fix', fixIsGood);
  btn.classList.toggle('no-fix', !fixIsGood);
}

async function ensurePermission(): Promise<boolean> {
  // On native platforms this prompts for permission the first time.
  if (!Capacitor.isNativePlatform()) return true;
  const perm = await Geolocation.checkPermissions();
  if (perm.location === 'granted') return true;
  const req = await Geolocation.requestPermissions();
  return req.location === 'granted';
}

// Each start bumps the generation, so a watch that is still being set up
// when we stop (or restart) gets cleared instead of left running.
let watchGeneration = 0;
let watchId: string | null = null;
let staleTimer: ReturnType<typeof setInterval> | undefined;

// The time we received the current fix, used to detect when updates stop.
let fixReceivedAt = 0;

function onPosition(pos: Position | null) {
  if (pos) {
    // When a watch starts, iOS typically delivers its last known location
    // first, which may be minutes old; don't treat that as a current fix.
    if (Date.now() - pos.timestamp > STALE_FIX_MS) return;
    currentFix = pos;
    fixReceivedAt = Date.now();
  } else {
    currentFix = null;
  }
  render();
}

// The OS may simply stop delivering updates when signal is lost, so treat
// an old fix as no fix.
function checkStale() {
  if (currentFix && Date.now() - fixReceivedAt > STALE_FIX_MS) {
    currentFix = null;
    render();
  }
}

async function startWatching() {
  stopWatching();
  const generation = watchGeneration;
  try {
    if (!(await ensurePermission())) return;
    if (generation !== watchGeneration) return;
    const id = await Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
        // Android only; iOS delivers updates as CoreLocation produces them.
        interval: 200,
        minimumUpdateInterval: 200,
      },
      onPosition,
    );
    if (generation !== watchGeneration) {
      await Geolocation.clearWatch({ id });
      return;
    }
    watchId = id;
    staleTimer = setInterval(checkStale, 500);
  } catch (err) {
    console.warn('Location watch failed:', err);
  }
}

function stopWatching() {
  watchGeneration++;
  clearInterval(staleTimer);
  if (watchId) {
    Geolocation.clearWatch({ id: watchId });
    watchId = null;
  }
  currentFix = null;
  render();
}

// Scan a QR code with the native live scanner. Resolves to null if the user cancels.
async function scanQrCode(): Promise<string | null> {
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
      scanInstructions: 'Point the camera at the QR code',
    });
    return result.ScanResult;
  } catch (err) {
    if ((err as { code?: string }).code === SCAN_CANCELLED) return null;
    throw err;
  }
}

// Defaults for the next reading, taken from the last saved one: the two
// locality lines (always saved together, since they describe one place) and
// the collector. Kept in localStorage: losing them (the OS may clear web
// storage) only means retyping them.
const LAST_DETAILS_KEY = 'lastDetails';

type RememberedDetails = Pick<ReadingDetails, 'locality' | 'locality2' | 'collector'>;

function loadLastDetails(): Partial<RememberedDetails> {
  try {
    return JSON.parse(localStorage.getItem(LAST_DETAILS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function saveLastDetails({ locality, locality2, collector }: RememberedDetails) {
  try {
    localStorage.setItem(LAST_DETAILS_KEY, JSON.stringify({ locality, locality2, collector }));
  } catch {
    // Not worth bothering the user about.
  }
}

// Ask for the optional locality (two lines), taxon and collector. Resolves to null if the
// user discards the reading.
function askDetails(code: string): Promise<ReadingDetails | null> {
  set('details-code', code);
  const last = loadLastDetails();
  localityInput.value = last.locality ?? '';
  locality2Input.value = last.locality2 ?? '';
  taxonInput.value = '';
  collectorInput.value = last.collector ?? '';
  detailsEl.returnValue = '';
  detailsEl.showModal();
  return new Promise((resolve) => {
    detailsEl.addEventListener(
      'close',
      () => {
        if (detailsEl.returnValue !== 'save') {
          resolve(null);
          return;
        }
        const text = (input: HTMLInputElement) => input.value.trim() || null;
        const details = {
          code,
          locality: text(localityInput),
          locality2: text(locality2Input),
          taxon: text(taxonInput),
          collector: text(collectorInput),
        };
        saveLastDetails(details);
        resolve(details);
      },
      { once: true },
    );
  });
}

// The keyboard's return key would submit the form with its first button
// (Discard), so make it move to the next field or dismiss the keyboard instead.
detailsEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
  e.preventDefault();
  if (e.target === localityInput) locality2Input.focus();
  else if (e.target === locality2Input) taxonInput.focus();
  else if (e.target === taxonInput) collectorInput.focus();
  else e.target.blur();
});

let scanning = false;

async function recordFix() {
  // Keep the fix from when the user tapped: on Android the scanner covers the
  // app, which stops the location watch until we're back in the foreground.
  const pos = currentFix;
  if (!pos || scanning) return;
  scanning = true;
  let code: string | null;
  try {
    code = await scanQrCode();
  } catch (scanErr) {
    const msg = scanErr instanceof Error ? scanErr.message : String(scanErr);
    alert(`Scan failed: ${msg}`);
    return;
  } finally {
    scanning = false;
  }
  if (code == null) return;
  if (code.length > MAX_CODE_LENGTH) {
    alert(`Not a valid ID: QR code is longer than ${MAX_CODE_LENGTH} characters.`);
    return;
  }
  const details = await askDetails(code);
  if (!details) return;
  try {
    if (!store) throw new Error('storage unavailable');
    await store.insertReading(pos, details);
    await refreshHistory();
    historyEl.parentElement!.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (saveErr) {
    const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
    alert(`Fix not saved: ${msg}`);
  }
}

btn.addEventListener('click', recordFix);
render();
renderSelection();

// Watch location only while the app is in the foreground.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') startWatching();
  else stopWatching();
});
if (document.visibilityState === 'visible') startWatching();

// Open the database and show any previously saved readings on startup. The
// native splash screen stays up until then (launchAutoHide is off), so the
// user never sees a blank web view.
(async () => {
  try {
    store = await getStore();
    await refreshHistory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await SplashScreen.hide();
    alert(`Storage unavailable: ${msg}`);
  } finally {
    await SplashScreen.hide();
  }
})();
