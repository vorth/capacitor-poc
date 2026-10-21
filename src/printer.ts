import { registerPlugin } from '@capacitor/core';

/**
 * The app's own native plugin (`PrinterPlugin` in the iOS and Android
 * projects). Platform WebViews ignore `window.print()`, so this opens the
 * system print dialog for the whole web view, laid out with `@media print`
 * styles. On web it falls back to `window.print()`.
 */
interface PrinterPlugin {
  printWebView(options?: { jobName?: string }): Promise<void>;
}

export const Printer = registerPlugin<PrinterPlugin>('Printer', {
  web: {
    printWebView: async () => window.print(),
  },
});
