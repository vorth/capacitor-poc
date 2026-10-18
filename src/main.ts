import './style.css';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { getStore, type Reading, type ReadingsStore } from './db';

const STALE_FIX_MS = 3000;
// Hysteresis: turn green at GOOD_ACCURACY_M or better, but only drop back to
// amber once accuracy is worse than POOR_ACCURACY_M.
const GOOD_ACCURACY_M = 40;
const POOR_ACCURACY_M = 50;

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <header class="toolbar">
    <button id="select-btn" type="button" class="text-btn">Select</button>
  </header>
  <main class="card">
    <ol id="history-list" class="history-list"></ol>
  </main>
  <div id="action-bar" class="action-bar" hidden>
    <button id="delete-btn" type="button" class="icon-btn" aria-label="Delete selected readings" disabled>
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      </svg>
    </button>
  </div>
  <button id="fix-btn" type="button" class="no-fix" aria-label="Record location fix">
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
    <svg class="icon icon-filled" viewBox="0 0 24 24" aria-hidden="true">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  </button>
  <dialog id="inspector" class="inspector" aria-labelledby="inspector-title">
    <h2 id="inspector-title"><span id="inspector-date"></span><span id="inspector-time" class="time"></span></h2>
    <dl class="result">
      <div><dt>Latitude</dt><dd id="lat">—</dd></div>
      <div><dt>Longitude</dt><dd id="lng">—</dd></div>
      <div><dt>Accuracy</dt><dd id="acc">—</dd></div>
      <div><dt>Altitude</dt><dd id="alt">—</dd></div>
    </dl>
    <form method="dialog">
      <button type="submit" class="close-btn">Close</button>
    </form>
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

let store: ReadingsStore | null = null;

// Most recent position from the location watch; null when we have no usable fix.
let currentFix: Position | null = null;

const set = (id: string, value: string) => {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = value;
};

// Local date as `yyyy-mm-dd` and time as `hh:mm` (24-hour).
function formatReading(r: Reading): { date: string; time: string } {
  const d = new Date(r.recordedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function inspect(r: Reading) {
  const { date, time } = formatReading(r);
  set('inspector-date', date);
  set('inspector-time', time);
  set('lat', r.latitude.toFixed(5) + '°');
  set('lng', r.longitude.toFixed(5) + '°');
  set('acc', `± ${r.accuracy.toFixed(0)} m`);
  set('alt', r.altitude != null ? `${r.altitude.toFixed(0)} m` : 'n/a');
  inspectorEl.showModal();
}

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

function onReadingTap(r: Reading) {
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
  const readings = await store.getReadings(count);
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
      const { date, time } = formatReading(r);
      const dateEl = document.createElement('span');
      dateEl.className = 'date';
      dateEl.textContent = date;
      const timeEl = document.createElement('span');
      timeEl.className = 'time';
      timeEl.textContent = time;
      item.append(check, dateEl, timeEl);
      item.addEventListener('click', () => onReadingTap(r));
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

// Tapping the backdrop (outside the dialog box) closes a dialog.
for (const dialog of [inspectorEl, confirmEl]) {
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

async function recordFix() {
  const pos = currentFix;
  if (!pos) return;
  try {
    if (!store) throw new Error('storage unavailable');
    await store.insertReading(pos);
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

// Open the database and show any previously saved readings on startup.
(async () => {
  try {
    store = await getStore();
    await refreshHistory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Storage unavailable: ${msg}`);
  }
})();
