# CheckrSpot2: Capacitor Geolocation POC

A minimal Capacitor app (Vanilla TS + Vite) that requests a location fix from
native APIs via [`@capacitor/geolocation`](https://capacitorjs.com/docs/apis/geolocation),
displays the coordinates along with the reported accuracy, and persists each
fix to a local SQLite database via
[`@capacitor-community/sqlite`](https://github.com/capacitor-community/sqlite)
so a short history of recent readings survives app restarts.

## Stack

- **Frontend:** Vanilla TypeScript + Vite
- **Native bridge:** Capacitor 8 (iOS + Android)
- **Geolocation:** `@capacitor/geolocation` (native GPS on device, browser Geolocation API on web)
- **Persistence:** `@capacitor-community/sqlite` (native SQLite on iOS/Android; in-memory stub on web — see [Persistence](#persistence))

## Prerequisites

- Node 22+, npm 10+
- **iOS:** Xcode (dependencies are resolved via Swift Package Manager — no CocoaPods needed)
- **Android:** Android Studio + SDK, with `ANDROID_HOME` set

## Develop (web)

```bash
npm install
npm run dev        # Vite dev server; geolocation falls back to the browser API
```

## Build & sync to native

```bash
npm run build      # produces dist/ (Capacitor's webDir)
npx cap sync       # copies web assets + config into ios/ and android/
```

## Run on device / simulator

```bash
npx cap run ios        # or: npx cap open ios     (opens Xcode)
npx cap run android    # or: npx cap open android (opens Android Studio)
```

## Permissions

Native location usage strings are already configured:

- **iOS** — `NSLocationWhenInUseUsageDescription` in `ios/App/App/Info.plist`
- **Android** — `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` in
  `android/app/src/main/AndroidManifest.xml`

The app requests permission at runtime the first time you tap **Get Location Fix**
on a native platform.

## Persistence

Each successful fix is saved to a `readings` table (latitude, longitude,
accuracy, altitude, recorded-at timestamp), and the UI shows the 5 most
recent readings plus a running total. See `src/db.ts` for the schema and
`ReadingsStore` interface.

- **Native (iOS/Android):** backed by real SQLite via
  `@capacitor-community/sqlite`. Schema migrations live in the
  `UPGRADE_STATEMENTS` array — add a new `{ toVersion, statements }` entry
  and bump `DB_VERSION` for future changes; never edit an existing entry.
- **Web (`npm run dev` / `vite preview`):** an in-memory stub is used
  instead, so `npm run dev` works without a jeep-sqlite/wasm setup. Readings
  do **not** persist across page reloads in this mode. Swap in a
  jeep-sqlite-backed store if real browser persistence is needed for a demo.

A failed save surfaces as a status message (the acquired fix is still shown)
rather than throwing — see `getFix()` in `src/main.ts`.

## Project layout

- `src/main.ts` — UI and geolocation logic
- `src/db.ts` — `ReadingsStore` (SQLite on native, in-memory stub on web) and schema
- `src/style.css` — styles (light/dark aware)
- `capacitor.config.ts` — Capacitor config (appId, webDir)
- `ios/`, `android/` — native platform projects
