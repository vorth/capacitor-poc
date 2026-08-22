# Capacitor Geolocation POC

A minimal Capacitor app (Vanilla TS + Vite) that requests a location fix from
native APIs via [`@capacitor/geolocation`](https://capacitorjs.com/docs/apis/geolocation)
and displays the coordinates along with the reported accuracy.

## Stack

- **Frontend:** Vanilla TypeScript + Vite
- **Native bridge:** Capacitor 8 (iOS + Android)
- **Geolocation:** `@capacitor/geolocation` (native GPS on device, browser Geolocation API on web)

## Prerequisites

- Node 22+, npm 10+
- **iOS:** Xcode + CocoaPods (`sudo gem install cocoapods` or `brew install cocoapods`)
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

## Project layout

- `src/main.ts` — UI and geolocation logic
- `src/style.css` — styles (light/dark aware)
- `capacitor.config.ts` — Capacitor config (appId, webDir)
- `ios/`, `android/` — native platform projects
