# CheckrSpot

A Capacitor app (Vanilla TS + Vite) for recording spots in the field. At each
spot you scan the short QR code ID tag placed there; the app saves that ID
with the current GPS fix and an optional two-line locality, taxon and collector, in a local SQLite
database.

## Stack

- **Frontend:** Vanilla TypeScript + Vite
- **Native bridge:** Capacitor 8 (iOS + Android)
- **Geolocation:** [`@capacitor/geolocation`](https://capacitorjs.com/docs/apis/geolocation)
  (native GPS on device, browser Geolocation API on web)
- **QR scanning:** [`@capacitor/barcode-scanner`](https://capacitorjs.com/docs/apis/barcode-scanner)
  (native live scanner on device, webcam via `html5-qrcode` on web)
- **Persistence:** [`@capacitor-community/sqlite`](https://github.com/capacitor-community/sqlite)
  (native SQLite on iOS/Android; in-memory stub on web — see [Persistence](#persistence))
- **Printing:** a small plugin inside the app (`PrinterPlugin` in `ios/App/App/`
  and the Android `org.vorthmann.checkrspot` package) that opens the system
  print dialog for the web view; `window.print()` on web
- **Clipboard:** [`@capacitor/clipboard`](https://capacitorjs.com/docs/apis/clipboard)
- **Saving files:** another small in-app plugin (`FileSaverPlugin`) that opens
  the system save dialog (iOS document picker, Android "save as"); no
  permissions needed. A browser download on web
- **Reverse geocoding:** OpenStreetMap's [Nominatim](https://nominatim.org/),
  called with `CapacitorHttp` (part of `@capacitor/core`) — see
  [Region lookup](#region-lookup)

## Using the app

- The capture button at the bottom turns **green** when the location
  accuracy is good (40 m or better) and **amber** when it is poor or there is
  no fix. You can still record with a poor fix.
- Tap it to open the QR scanner. Once a code is read, enter an optional
  **Locality** (two lines), **Taxon** and **Collector** (keyboard dictation works), then **Save**, or
  **Discard** to drop the reading. The location saved is the one from when you
  tapped the button. Both locality lines and Collector start out filled in
  with the values from the last reading you saved.
- The list shows each reading's ID and taxon, newest first. Tap one to see its
  time, date, region, locality, coordinates, accuracy, altitude and collector.
- **Select** lets you pick readings and delete them, or tap **Labels** to
  preview specimen labels for them (oldest first, shown at twice actual size)
  and **Print** them. Each label has a locality block (region, both locality lines, coordinates
  ± accuracy, date and time, elevation, collector), the taxon if there is one, and the ID in large type.
  If any of the readings still need their region looked up, the sheet shows
  "Reverse geocoding…" first; if a lookup fails you can **Retry**, **Cancel**,
  or **Continue anyway** without the missing regions.
- The copy button next to **Labels** copies the selected readings (oldest
  first) to the clipboard as **JSON** or **CSV**; the format you chose last is
  preselected. Missing regions are looked up first, as for labels. JSON
  includes the full reverse-geocoding response (`revGeocode`, which carries
  the OpenStreetMap licence notice) and leaves out empty fields; CSV has a
  header row and fixed columns.
- The download button next to it saves the same JSON or CSV to a file
  (e.g. `checkrspot-2026-10-25-1432.csv`) wherever you choose in the system
  save dialog. It remembers its own last format, separately from copy.

## Region lookup

Each reading gets a short **region** such as `US-AZ, Pima Co.` (the ISO region
code, then the county or nearest equivalent) from Nominatim. The app is often
used without a network, so nothing is looked up when a reading is captured.
A lookup happens only when you open a reading in the list (for that reading)
or tap **Labels**, copy or download (for the selected readings that don't have one yet). Results
are saved, so each reading is looked up once.

Nominatim's [usage policy](https://operations.osmfoundation.org/policies/nominatim/)
allows at most one request per second across all users of the app, so
requests are queued about 1.5 s apart and nearby readings share a cached
answer. The full response is stored for a future export; its data is
© OpenStreetMap contributors (ODbL). The design is in
[`dev-docs/reverse-geocoding.md`](dev-docs/reverse-geocoding.md).

## Prerequisites

- Node 22+, npm 10+
- **iOS:** Xcode (dependencies are resolved via Swift Package Manager — no CocoaPods needed)
- **Android:** Android Studio + SDK, with `ANDROID_HOME` set; minimum Android 8.0 (API 26)

## Develop (web)

```bash
npm install
npm run dev        # Vite dev server; uses the browser's location and webcam
```

## Build & sync to native

```bash
npm run build      # type-checks, then produces dist/ (Capacitor's webDir)
npx cap copy ios   # copy web assets into the iOS project (after code changes)
npx cap sync       # copy assets and update native plugins (after adding/removing a plugin)
```

## Run on device / simulator

```bash
npx cap run ios        # or: npx cap open ios     (opens Xcode; app scheme is CheckrSpot2)
npx cap run android    # or: npx cap open android (opens Android Studio)
```

Scanning needs a real device; the iOS simulator has no camera.

iOS builds run from Xcode (Debug) install as **CheckrDev**
(`org.vorthmann.checkrspot.dev`), so they can sit alongside the App Store
version of CheckrSpot. Archived (Release) builds use the real bundle id
`org.vorthmann.checkrspot` and replace the older CheckrSpot app in the App Store.

## Permissions

- **iOS** — `NSLocationWhenInUseUsageDescription` and `NSCameraUsageDescription`
  in `ios/App/App/Info.plist`
- **Android** — `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` in
  `android/app/src/main/AndroidManifest.xml`; the camera permission is expected
  to come from the scanner plugin's library (not yet verified on a device)

Location permission is requested when the app first starts; camera permission
the first time you scan.

## Persistence

Each reading is saved to a `readings` table: latitude, longitude, accuracy,
altitude, recorded-at timestamp, `code` (the scanned ID, at most 25
characters), `locality`, `locality2`, `taxon`, `collector`, and from the
region lookup `region`, `place_source` (e.g. `nominatim`; empty until looked
up) and `place_details` (the service's full response as JSON). See `src/db.ts` for the schema and
`ReadingsStore` interface.

- **Native (iOS/Android):** backed by real SQLite via
  `@capacitor-community/sqlite`. The schema lives in the `UPGRADE_STATEMENTS`
  array. **Until the first release** the version-1 entry is edited in place, so
  after a schema change delete the app from the device and reinstall it. After
  release, add a new `{ toVersion, statements }` entry and bump `DB_VERSION`
  instead; never edit an existing entry.
- **Web (`npm run dev` / `vite preview`):** an in-memory stub is used
  instead, so `npm run dev` works without a jeep-sqlite/wasm setup. Readings
  do **not** persist across page reloads in this mode.

A failed save is reported in an alert rather than crashing the app.

## Project layout

- `src/main.ts` — UI, location watching, scanning and the capture flow
- `src/db.ts` — `ReadingsStore` (SQLite on native, in-memory stub on web) and schema
- `src/export.ts` — JSON and CSV formatting for copying and downloading readings
- `src/fileSaver.ts` — JS side of the app's own `FileSaver` plugin
- `src/printer.ts` — JS side of the app's own `Printer` plugin
- `src/geocoder.ts` — the `ReverseGeocoder` interface the app uses for region lookups
- `src/nominatim.ts` — its Nominatim implementation (request queue, cache, region format)
- `src/style.css` — styles (light/dark aware), including the label and print styles
- `capacitor.config.ts` — Capacitor config (appId, webDir)
- `ios/`, `android/` — native platform projects
- `dev-docs/` — design notes
- `CLAUDE.md` — notes for Claude Code sessions
