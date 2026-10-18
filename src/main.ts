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
  <main class="card">
    <ol id="history-list" class="history-list"></ol>
  </main>
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
`;

const btn = document.querySelector<HTMLButtonElement>('#fix-btn')!;
const historyEl = document.querySelector<HTMLOListElement>('#history-list')!;
const inspectorEl = document.querySelector<HTMLDialogElement>('#inspector')!;

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
  set('acc', `± ${r.accuracy.toFixed(1)} m`);
  set('alt', r.altitude != null ? `${r.altitude.toFixed(1)} m` : 'n/a');
  inspectorEl.showModal();
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
      const { date, time } = formatReading(r);
      const dateEl = document.createElement('span');
      dateEl.textContent = date;
      const timeEl = document.createElement('span');
      timeEl.className = 'time';
      timeEl.textContent = time;
      item.append(dateEl, timeEl);
      item.addEventListener('click', () => inspect(r));
      li.append(item);
      return li;
    }),
  );
}

// Tapping the backdrop (outside the dialog box) closes the inspector.
inspectorEl.addEventListener('click', (e) => {
  if (e.target === inspectorEl) inspectorEl.close();
});

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
