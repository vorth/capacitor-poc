import { registerPlugin } from '@capacitor/core';

interface SaveFileOptions {
  filename: string;
  contents: string;
  mimeType: string;
}

/**
 * The app's own native plugin (`FileSaverPlugin` in the iOS and Android
 * projects). Opens the system's save dialog so the user picks where the file
 * goes: the document picker on iOS (Files, iCloud Drive, …), the Storage
 * Access Framework on Android. Neither needs a permission. On web it
 * downloads the file through the browser.
 */
interface FileSaverPlugin {
  /** Resolves with `saved: false` if the user cancels. */
  saveFile(options: SaveFileOptions): Promise<{ saved: boolean }>;
}

export const FileSaver = registerPlugin<FileSaverPlugin>('FileSaver', {
  web: {
    saveFile: async ({ filename, contents, mimeType }: SaveFileOptions) => {
      const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { saved: true };
    },
  },
});
