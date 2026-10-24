import { Capacitor, CapacitorHttp } from '@capacitor/core';
import type { Place, ReverseGeocoder } from './geocoder';

const SOURCE = 'nominatim';
const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
// Nominatim's usage policy requires an identifying User-Agent and at most one
// request per second across all users of the app.
const USER_AGENT = 'CheckrSpot/2.0';
const MIN_INTERVAL_MS = 1500;
const TIMEOUT_MS = 10000;

/** The request never got an answer (offline, timeout). */
class NetworkError extends Error {}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

interface NominatimResponse {
  error?: string;
  display_name?: string;
  address?: Record<string, string>;
}

// As in the old app: the ISO region code, then the first part of the display
// name (at zoom 9 usually the county) with "County" shortened to "Co.".
// "Pima County, Arizona, United States" + "US-AZ" → "US-AZ, Pima Co."
function formatRegion(data: NominatimResponse): string | null {
  const first = (data.display_name ?? '').split(',')[0].trim().replace(/County/g, 'Co.');
  const iso = data.address?.['ISO3166-2-lvl4'] ?? '';
  return [iso, first].filter(Boolean).join(', ') || null;
}

/** Reverse geocoding with OpenStreetMap's Nominatim service. */
export class NominatimGeocoder implements ReverseGeocoder {
  // Keyed by coordinates rounded to ~100 m, which is within GPS error. Holds
  // requests in progress too, so a repeat shares the first one's answer.
  private cache = new Map<string, Promise<Place>>();
  // Requests run one at a time, in order, spaced MIN_INTERVAL_MS apart.
  private tail: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;
  // Bumped when a request fails for lack of a network, which fails every
  // request queued before then instead of waiting out each one's timeout.
  private generation = 0;

  lookup(latitude: number, longitude: number): Promise<Place> {
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const place = this.enqueue(() => this.request(latitude, longitude));
    this.cache.set(key, place);
    // Don't remember failures; the next lookup tries again.
    place.catch(() => {
      if (this.cache.get(key) === place) this.cache.delete(key);
    });
    return place;
  }

  private enqueue(task: () => Promise<Place>): Promise<Place> {
    const generation = this.generation;
    const run = this.tail.then(async () => {
      if (generation !== this.generation) throw new NetworkError('No network connection');
      await wait(this.lastRequestAt + MIN_INTERVAL_MS - Date.now());
      try {
        return await task();
      } catch (err) {
        if (err instanceof NetworkError) this.generation++;
        throw err;
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.tail = run.catch(() => {});
    return run;
  }

  private async request(latitude: number, longitude: number): Promise<Place> {
    let res;
    try {
      res = await CapacitorHttp.get({
        url: ENDPOINT,
        params: {
          format: 'jsonv2',
          lat: String(latitude),
          lon: String(longitude),
          zoom: '9',
          'accept-language': 'en',
        },
        // Browsers don't let pages set User-Agent (and trying could trigger a
        // CORS preflight), so only send it natively.
        headers: Capacitor.isNativePlatform() ? { 'User-Agent': USER_AGENT } : {},
        connectTimeout: TIMEOUT_MS,
        readTimeout: TIMEOUT_MS,
        responseType: 'json',
      });
    } catch (err) {
      throw new NetworkError(err instanceof Error ? err.message : String(err));
    }
    if (res.status !== 200) throw new Error(`Nominatim returned HTTP ${res.status}`);
    const data: NominatimResponse = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
    // An `error` (e.g. "Unable to geocode" for open ocean) is an answer, not a failure.
    return { region: data.error ? null : formatRegion(data), source: SOURCE, details: data };
  }
}
