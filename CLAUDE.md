# CheckrSpot

Field data-collection app (Capacitor 8, iOS + Android). At each spot the
user scans a short QR code ID tag, and the app saves it with a GPS fix and
optional free-text **locality** and **taxon**. Readings are stored locally in
SQLite; photos are not taken or stored. Pre-release proof of concept with no
users yet.

The [README.md](README.md) covers setup, build/run commands, permissions and
persistence for humans. Keep it in sync when behaviour, schema, permissions or
dependencies change.

## Workflow

- After every change to `src/`, `index.html` or config, run
  `npm run build && npx cap copy ios`. The user runs the app from Xcode, which
  loads web assets from `ios/App/App/public`; skipping the copy leaves a stale
  build on the device.
- Adding or removing a native plugin needs `npx cap sync` instead of `copy`.
- `npm run build` runs `tsc` first, so it doubles as the type check. There are
  no tests or linter.
- iOS compile check without a device:
  `xcodebuild -project ios/App/App.xcodeproj -scheme CheckrSpot2 -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO`
  (the Xcode project is `App.xcodeproj`, but the app scheme is **CheckrSpot2**).
  Don't boot or run simulators; the user tests on their own phone.

## Stack

- Vanilla TypeScript + Vite 8, no framework. TypeScript 6.
- `vite.config.ts` sets `build.target` to `es2020`/`chrome91`/`safari15`
  because the app runs in platform WebViews, which can be old (Android 12
  emulator images ship Chrome ~91; iOS 15 is the deployment target). Without
  it the minifier drops CSS fallbacks such as `height: 100%` before `100dvh`.
  When using newer CSS, add a fallback and check it survives in `dist/`.
- Capacitor 8. iOS dependencies via **Swift Package Manager** (no CocoaPods);
  any new plugin must ship a `Package.swift`.
- Plugins: `@capacitor/geolocation`, `@capacitor/barcode-scanner` (official
  Ionic/OutSystems live scanner), `@capacitor-community/sqlite`,
  `@capacitor/splash-screen`.

## Files

- `src/main.ts` — all UI and logic. Markup is one `app.innerHTML` template
  (list, capture button, three `<dialog>`s), followed by plain DOM code. No
  components or state library.
- `src/db.ts` — `Reading` type, `ReadingsStore` interface, schema, and two
  implementations: SQLite on native, in-memory stub on web (`npm run dev`).
- `src/style.css` — light/dark themes via CSS variables on `:root`; iOS-like
  look.
- `ios/App/App/Info.plist` — camera and location usage strings.
- `android/variables.gradle` — `minSdkVersion = 26` (required by the scanner).

## Data model

Table `readings` (`src/db.ts`): `id` (autoincrement row id), `latitude`,
`longitude`, `accuracy` (m), `altitude` (m, nullable), `recorded_at` (epoch
ms, from the fix's timestamp), `code` (text, NOT NULL, CHECK length ≤
`MAX_CODE_LENGTH` = 25), `locality` and `taxon` (text, null when blank).
TS fields are camelCase (`recordedAt`); `ReadingDetails` = code + locality +
taxon.

- `id` is the row id. The scanned value is **`code`** (the user rejected
  reusing `id` for it). The UI labels the code "ID".
- Codes are short alphanumerics, typically 2–5 characters, never more than 25.
- **Schema policy before first release:** edit the version-1 statement in
  place and keep `DB_VERSION = 1`; no migrations. Existing installs must be
  deleted and reinstalled after a schema change; tell the user this. After
  release, add new `{ toVersion, statements }` entries instead.

## Behaviour

- **Location watch** runs only while the app is visible (`visibilitychange`
  starts/stops it). Fixes older than `STALE_FIX_MS` (3 s) are ignored, which
  drops the stale cached location iOS sends first. If no updates arrive for
  3 s the fix is cleared.
- **Capture button** (QR icon + location arrow) is amber when there's no fix
  or accuracy is poor, and green when accuracy is good: ≤ 40 m to turn green,
  > 50 m to drop back (hysteresis). The colour is advisory only; any current
  fix can be recorded.
- **Capture flow** (`recordFix`): snapshot the current fix at tap time (on
  Android the scanner covers the app, which stops the watch) → native live
  scanner restricted to QR codes → reject codes over 25 characters → details
  dialog with optional Locality / Taxon → insert → refresh list.
  - Cancelling the scanner rejects with code `OS-PLUG-BARC-0006`, treated as
    a silent cancel. This was taken from the plugin's iOS source; not yet
    confirmed on Android.
  - Details dialog: Discard drops the whole reading. Return in Locality moves
    to Taxon, and in Taxon dismisses the keyboard (otherwise it would submit
    the form via its first button, Discard). No backdrop-tap close, so typed
    text isn't lost. Taxon has autocorrect/spellcheck off (Latin names).
    Inputs are ≥ 16px to avoid iOS focus zoom. The dialog sits near the top so
    the keyboard doesn't cover it. Native keyboard dictation works with no
    extra permission.
- **List**: all readings, newest first. Each row shows code (bold, left) and
  taxon (right, ellipsized). Tap opens the inspector dialog: title is code +
  taxon; rows are Time, Date, Locality, Latitude, Longitude, Accuracy,
  Altitude.
- **Selection mode** (toolbar Select/Cancel): rows toggle iOS-style
  checkmarks, the capture button is replaced by an action bar with a delete
  button, and deletion asks for confirmation.
- Errors are shown with `alert()`.

## App identity and App Store plan

- App id is `org.vorthmann.checkrspot` everywhere (`capacitor.config.ts`, iOS
  bundle id, Android `applicationId`/`namespace`; `MainActivity` lives in that
  Java package), except iOS **Debug** builds.
- iOS Debug builds (Run from Xcode) use bundle id
  `org.vorthmann.checkrspot.dev` and home-screen name "CheckrDev", so they
  install alongside the old App Store app on the user's phone. Release builds
  (Archive) use the real id and "CheckrSpot". Both come from per-configuration
  target build settings (`PRODUCT_BUNDLE_IDENTIFIER`, `APP_DISPLAY_NAME`);
  Info.plist's `CFBundleDisplayName` is `$(APP_DISPLAY_NAME)`. The Xcode
  target/scheme is still named CheckrSpot2.
- That bundle id belongs to the user's older iOS-only app **CheckrSpot**, which
  this app will replace in the App Store as an update to the same app record.
  So: keep the bundle id and team (`85ZT5UZ396`); `MARKETING_VERSION` must stay
  above the old app's latest App Store version (currently set to 2.0); don't
  drop iPad support (`TARGETED_DEVICE_FAMILY = "1,2"`); don't raise the iOS
  deployment target (15.0) without considering existing users. Updating users
  keep the old app's sandbox data; the old app stored none, so no import is
  needed.

## Icons and splash

The butterfly icon comes from the old app
(`../checkrspot/CheckrSpot/CheckrSpot/Assets.xcassets/AppIcon.appiconset/icon-1024.png`).
iOS uses it directly. The Android launcher icons and Android splash images
(`drawable*/splash.png`) were generated from it with throwaway CoreGraphics
scripts: the butterfly centred on its own flat grey,
**`#C1C1C1`** (raw pixel value; colour-converted sampling misreports it as
`#CCCCCC`). Android's `ic_launcher_background` and Android 12+
`windowSplashScreenBackground` use that grey.

iOS launch screen (`LaunchScreen.storyboard`): grey `#C1C1C1` view with the
`Splash` image (the icon at 240/480/720 px) centred at 240 pt. Don't go back
to Capacitor's full-screen 2732 px splash image: the user saw only a black
launch screen with it, likely because iOS couldn't render an image that large.
`@capacitor/splash-screen` re-shows that storyboard and, with
`launchAutoHide: false`, keeps it up until `SplashScreen.hide()` at the end of
startup in `src/main.ts`; this covers the blank white web view.

## Known quirks

- The scanner plugin bundles `html5-qrcode` for web, so the JS bundle is about
  400 KB. Harmless for native; it lets scanning work with a webcam in
  `npm run dev`.
- The web store is in-memory only; readings vanish on reload.
