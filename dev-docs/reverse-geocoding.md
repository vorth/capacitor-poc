# Reverse geocoding plan

Status: implemented (2026-10-24).

Each reading gets a short **region** string (e.g. `US-AZ, Pima Co.`) from an
online reverse-geocoding service. It is printed as the first line of the
label's locality block. The app is often used without a network connection,
so lookups never happen at capture time. They run only when the user opens a
reading in the inspector or asks for labels.

## Background and decisions

The old app (`../checkrspot/CheckrSpot`) made three lookups per record. This
app makes only one:

| Old app lookup | Service | Here |
|---|---|---|
| Temperature | Open-Meteo `/v1/forecast` | **Dropped.** It's modelled data (archived forecasts for a 1–25 km grid cell), not a measurement, and it isn't the app's job. Add a manual field if users ask for it. |
| Elevation | open-elevation | **Dropped.** GPS already gives altitude. |
| Reverse geocoding | Nominatim | **Kept**, as `region`. |

Other decisions:

- The data field is named `region` (not the old app's `location`, which
  would be too easily confused with `locality`).
- Requests always ask for English names (`accept-language=en`).
- The full service response is stored so a future JSON export can include it.
- No periodic or network-triggered lookups, so `@capacitor/network` isn't
  needed.
- The inspector looks up only the reading it shows. Labels looks up the
  selected readings.
- The app depends only on a small interface that hides the service and its
  timing, so the service can be replaced later.

## Nominatim constraints

From the [usage policy](https://operations.osmfoundation.org/policies/nominatim/):

- At most 1 request per second, **counting all users of the app together**.
- No batch endpoint: one request per coordinate.
- Requests must identify the app with a User-Agent (or Referer). Default
  User-Agents from HTTP libraries aren't accepted.
- Results must be cached, and repeating the same query can get a client
  blocked.
- Data is © OpenStreetMap contributors, under the ODbL licence. A JSON export
  must include that attribution.

## Interface: `src/geocoder.ts`

```ts
export interface Place {
  /** Short text for labels, e.g. "US-AZ, Pima Co."; null if the service has no name here. */
  region: string | null;
  /** Which service produced `details`, e.g. "nominatim". */
  source: string;
  /** The service's full result, kept as-is for export. Its shape depends on `source`. */
  details: unknown;
}

export interface ReverseGeocoder {
  /**
   * Resolves when the place is known (including "nothing here", which resolves
   * with `region: null`). Rejects if the lookup couldn't be done (offline, service error).
   * Safe to call many times at once; the implementation decides when each request runs.
   */
  lookup(latitude: number, longitude: number): Promise<Place>;
}
```

The interface says nothing about timing. Callers request any number of places
at once and get one promise for each, which settles whenever the
implementation gets to it. Progress is measured by counting settled promises,
so there are no callbacks or progress events.

## Storage: `src/db.ts`

New nullable columns on `readings`:

| Column | Type | Meaning |
|---|---|---|
| `region` | TEXT | Label string. Null when not looked up yet, or when the service had no name for the spot. |
| `place_source` | TEXT | e.g. `'nominatim'`. **Null means not looked up yet.** |
| `place_details` | TEXT | `Place.details` as JSON. For Nominatim, the whole response (`address`, `display_name`, `licence`, …). |

- In TypeScript, `Reading` gains `region: string | null` and
  `place: { source: string; details: unknown } | null`.
- `ReadingsStore` gains `setPlace(id, place)`.
- The source tag tells an export how to read `place_details`, even after a
  change of service.
- Per the pre-release schema policy, the version-1 statement is edited in
  place, so existing installs must be deleted and reinstalled.

## App side: `src/main.ts`

```ts
const geocoder: ReverseGeocoder = new NominatimGeocoder();
```

The helper `resolvePlace(r)` calls `geocoder.lookup(r.latitude, r.longitude)`,
then `store.setPlace(r.id, place)`, and resolves with the updated reading.

### Inspector

- A new **Region** row is added.
- If the reading has no place yet, the row shows "Looking up…" and
  `resolvePlace` runs for **that reading only**.
- When the lookup resolves, the row updates, but only if the inspector still
  shows that reading.
- When it fails, the row shows "—" with no error message. The lookup is
  tried again the next time that reading is opened.

### Labels sheet

1. Call `resolvePlace` on each selected reading with no place, all at once.
   The sheet shows "Reverse geocoding… n of m", and each promise's `.then`
   advances the count.
2. Wait for them all with `Promise.allSettled`.
3. If all succeeded, render the labels, with region as the first line of the
   locality block (omitted when null).
4. If any failed, show "Couldn't look up the region for k of m readings" with:
   - **Cancel**: close the sheet.
   - **Retry**: run step 1 again for the selected readings still missing a
     place.
   - **Print anyway**: render the labels, with no region line on the ones
     that failed, and open the print dialog.
5. **Print** stays disabled until the labels are showing.

Each opening of the sheet gets a run ID. Results from an earlier run (the
sheet was closed and reopened) still save to the database but don't update
the sheet.

Readings that already have a place resolve without a request, so labels for
readings that were all looked up before appear immediately.

## Implementation: `src/nominatim.ts`

`NominatimGeocoder implements ReverseGeocoder`.

**Request:** made with `CapacitorHttp` (part of `@capacitor/core`, so no new
plugin), which can set a User-Agent where WebView `fetch` can't.

```
GET https://nominatim.openstreetmap.org/reverse
    ?format=jsonv2&lat=…&lon=…&zoom=9&accept-language=en
User-Agent: CheckrSpot/2.0
```

The User-Agent has no contact email; that was the user's choice. The timeout
is 10 s. In `npm run dev`, `CapacitorHttp` falls back to `fetch` without the
header, which is fine for testing.

**Spacing:** a promise chain makes each request start at least about 1.5 s
after the previous one finished. The wait happens inside the promise the
caller already holds.

**Cache:**
- Results are kept in memory, keyed by coordinates rounded to 0.001° (about
  100 m, within GPS error).
- A request in progress for the same key is shared, not repeated.
- Cached answers resolve immediately and don't use up a request slot.
- The database is the long-term store; this cache only saves repeat requests
  within one session.

**Offline fail-fast:** when a request fails at the network level, every
request still waiting in the queue rejects at once. Labels then reports the
failure right away instead of after a series of timeouts.

**Response handling:**

| Response | Result |
|---|---|
| 200 with an `error` field (e.g. open ocean) | Resolve: `region: null`, `details` = the response. Counts as done. |
| 200 with `address` | Resolve with `region` built as below, and `details` = the whole response. |
| Any other HTTP status, or a network error | Reject. |

**Region format** (copied from the old app's `ContentView.swift`):

1. Take the first comma-separated part of `display_name`, trimmed.
2. Replace `County` with `Co.`.
3. If `address["ISO3166-2-lvl4"]` exists, put it in front with `", "`.

Example: `display_name` "Pima County, Arizona, United States" with
`ISO3166-2-lvl4` "US-AZ" gives `US-AZ, Pima Co.`.

Known quirks, accepted:
- The first part isn't always a county: Louisiana gives "… Parish", Alaska a
  borough, and independent cities and many other countries give a city or
  district.
- Some countries have no `ISO3166-2-lvl4` (they use lvl3, lvl5 or lvl6), so
  the region is just the first part.

## Switching services later

1. Write a new class that implements `ReverseGeocoder`, with its own `source`
   tag and region formatting.
2. Change the one line in `main.ts` that creates the geocoder.

Nothing else changes. Stored rows keep their original `place_source`.

## Ordering example

The user inspects a reading (one request queued), closes the inspector,
selects four readings and taps Labels. The four join the same queue behind the
inspector's single request, so they wait at most about 1.5 s extra. Plain
first-come, first-served order is enough; there's no priority handling.
