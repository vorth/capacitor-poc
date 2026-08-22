import './style.css';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { getStore, type Reading, type ReadingsStore } from './db';

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <main class="card">
    <h1>Location Fix</h1>
    <p class="platform">Running on: <strong>${Capacitor.getPlatform()}</strong></p>
    <button id="fix-btn" type="button">Get Location Fix</button>
    <div id="status" class="status" role="status" aria-live="polite">
      Tap the button to request your current location.
    </div>
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
const resultEl = document.querySelector<HTMLDListElement>('#result')!;
const countEl = document.querySelector<HTMLSpanElement>('#count')!;
const historyEl = document.querySelector<HTMLOListElement>('#history-list')!;

let store: ReadingsStore | null = null;

const set = (id: string, value: string) => {
  document.querySelector<HTMLElement>(`#${id}`)!.textContent = value;
};

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

async function getFix() {
  btn.disabled = true;
  statusEl.textContent = 'Requesting location…';
  statusEl.classList.remove('error');
  try {
    // On native platforms this prompts for permission the first time.
    if (Capacitor.isNativePlatform()) {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted') {
          throw new Error('Location permission denied.');
        }
      }
    }

    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });

    showPosition(pos);
    statusEl.textContent = 'Location acquired.';

    // Persist the fix. A save failure must not discard the acquired reading,
    // so it surfaces as a note rather than throwing out of getFix().
    try {
      if (store) {
        await store.insertReading(pos);
        await refreshHistory();
      }
    } catch (saveErr) {
      const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      statusEl.textContent = `Location acquired (not saved: ${msg}).`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Error: ${message}`;
    statusEl.classList.add('error');
  } finally {
    btn.disabled = false;
  }
}

btn.addEventListener('click', getFix);

// Open the database and show any previously saved readings on startup.
(async () => {
  try {
    store = await getStore();
    await refreshHistory();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    statusEl.textContent = `Storage unavailable: ${msg}`;
    statusEl.classList.add('error');
  }
})();
