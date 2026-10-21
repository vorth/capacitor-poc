import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // The app runs in the platform WebView, not a current browser: iOS 15 is
    // the deployment target, and Android System WebView can be years old
    // (Android 12 emulator images ship Chrome ~91). Targeting these keeps CSS
    // fallbacks (e.g. `height: 100%` before `100dvh`) that the minifier would
    // otherwise drop, and builds JS those engines can run.
    target: ['es2020', 'chrome91', 'safari15'],
  },
});
