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
    <h1>Location Fix</h1>
    <p class="platform">Running on: <strong>${Capacitor.getPlatform()}</strong></p>
    <button id="fix-btn" type="button" class="no-fix" aria-label="Record location fix">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
      <svg class="icon icon-filled" viewBox="0 0 24 24" aria-hidden="true">
        <polygon points="3 11 22 2 13 21 11 13 3 11" />
      </svg>
    </button>
    <div id="status" class="status" role="status" aria-live="polite"></div>
    <div id="notice" class="status" aria-live="polite"></div>
    <dl id="result" class="result" hidden>
      <div><dt>Latitude</dt><dd id="lat">—</dd></div>
      <div><dt>Longitude</dt><dd id="lng">—</dd></div>
      <div><dt>Accuracy</dt><dd id="acc">—</dd></div>
      <div><dt>Altitude</dt><dd id="alt">—</dd></div>
      <div><dt>Timestamp</dt><dd id="ts">—</dd></div>
    </dl>
    <section class="history" aria-labelledby="history-heading">
      <h2 id="history-heading">Saved readings (<span id="count">0</span>)</h2>
      <ol id="history-list" class="history-list"></ol>
    </section>
  </main>
`;

const btn = document.querySelector<HTMLButtonElement>('#fix-btn')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const noticeEl = document.querySelector<HTMLDivElement>('#notice')!;
const resultEl = document.querySelector<HTMLDListElement>('#result')!;
const countEl = document.querySelector<HTMLSpanElement>('#count')!;
const historyEl = document.querySelector<HTMLOListElement>('#history-list')!;

let store: ReadingsStore | null = null;

// Most recent position from the location watch; null when we have no usable fix.
let currentFix: Position | null = null;

const set = (id: string, value: string) => {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = value;
};

// Why there is no fix (error, stale fix, permission), shown while waiting.
let waitReason: string | null = null;

// One-off messages (save results, storage errors), kept separate from the
// fix status so they can't contradict the button.
function setNotice(text: string, isError = false) {
  noticeEl.textContent = text;
  noticeEl.classList.toggle('error', isError);
}

function formatReading(r: Reading): string {
  const coords = `${r.latitude.toFixed(5)}, ${r.longitude.toFixed(5)}`;
  const when = new Date(r.recordedAt).toLocaleString();
  return `${coords} · ± ${r.accuracy.toFixed(0)} m · ${when}`;
}

async function refreshHistory() {
  if (!store) return;
  const [count, recent] = await Promise.all([
    store.getReadingCount(),
    store.getReadings(5),
  ]);
  countEl.textContent = String(count);
  historyEl.replaceChildren(
    ...recent.map((r) => {
      const li = document.createElement('li');
      li.textContent = formatReading(r);
      return li;
    }),
  );
}

function showPosition(pos: Position) {
  const c = pos.coords;
  set('lat', c.latitude.toFixed(6) + '°');
  set('lng', c.longitude.toFixed(6) + '°');
  set('acc', `± ${c.accuracy.toFixed(1)} m`);
  set('alt', c.altitude != null ? `${c.altitude.toFixed(1)} m` : 'n/a');
  set('ts', new Date(pos.timestamp).toLocaleTimeString());
  resultEl.hidden = false;
}

let fixIsGood = false;

// Button color and status line are both derived here from the current fix,
// so they always agree. Amber when there's no fix; otherwise green/amber per
// the accuracy thresholds.
function render() {
  if (currentFix == null) {
    fixIsGood = false;
  } else {
    const limit = fixIsGood ? POOR_ACCURACY_M : GOOD_ACCURACY_M;
    fixIsGood = currentFix.coords.accuracy <= limit;
  }
  btn.classList.toggle('good-fix', fixIsGood);
  btn.classList.toggle('no-fix', !fixIsGood);

  if (currentFix == null) {
    statusEl.textContent = waitReason
      ? `Waiting for location… (${waitReason})`
      : 'Waiting for location…';
  } else {
    const acc = `± ${currentFix.coords.accuracy.toFixed(1)} m`;
    statusEl.textContent = fixIsGood
      ? `Good fix (${acc}). Tap to record.`
      : `Low accuracy (${acc})…`;
  }
  statusEl.classList.toggle('error', currentFix == null && waitReason != null);
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

function onPosition(pos: Position | null, err?: unknown) {
  if (pos) {
    // When a watch starts, iOS typically delivers its last known location
    // first, which may be minutes old; don't treat that as a current fix.
    if (Date.now() - pos.timestamp > STALE_FIX_MS) return;
    currentFix = pos;
    fixReceivedAt = Date.now();
    waitReason = null;
    showPosition(pos);
  } else {
    currentFix = null;
    waitReason = err instanceof Error ? err.message : String(err ?? 'no position');
  }
  render();
}

// The OS may simply stop delivering updates when signal is lost, so treat
// an old fix as no fix.
function checkStale() {
  if (currentFix && Date.now() - fixReceivedAt > STALE_FIX_MS) {
    currentFix = null;
    waitReason = 'fix is stale';
    render();
  }
}

async function startWatching() {
  stopWatching();
  const generation = watchGeneration;
  try {
    if (!(await ensurePermission())) {
      waitReason = 'permission denied';
      render();
      return;
    }
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
    waitReason = err instanceof Error ? err.message : String(err);
    render();
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
  waitReason = null;
  render();
}

async function recordFix() {
  const pos = currentFix;
  if (!pos) {
    setNotice('No location fix yet.', true);
    return;
  }
  try {
    if (!store) throw new Error('storage unavailable');
    await store.insertReading(pos);
    await refreshHistory();
    setNotice(`Saved fix (± ${pos.coords.accuracy.toFixed(1)} m).`);
  } catch (saveErr) {
    const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
    setNotice(`Fix not saved: ${msg}`, true);
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
    setNotice(`Storage unavailable: ${msg}`, true);
  }
})();
