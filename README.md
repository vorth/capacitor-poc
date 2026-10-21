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
  time, date, locality, coordinates, accuracy, altitude and collector.
- **Select** lets you pick readings and delete them, or tap **Labels** to
  preview specimen labels for them (oldest first, shown at twice actual size)
  and **Print** them. Each label has a locality block (both locality lines, coordinates
  ± accuracy, date and time, elevation, collector), the taxon if there is one, and the ID in large type.

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
characters), `locality`, `locality2`, `taxon` and `collector`. See `src/db.ts` for the schema and
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
- `src/printer.ts` — JS side of the app's own `Printer` plugin
- `src/style.css` — styles (light/dark aware), including the label and print styles
- `capacitor.config.ts` — Capacitor config (appId, webDir)
- `ios/`, `android/` — native platform projects
- `CLAUDE.md` — notes for Claude Code sessions
