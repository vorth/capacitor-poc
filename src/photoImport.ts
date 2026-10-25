import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { MAX_CODE_LENGTH, type Fix } from './db';

/** What the native side read from one chosen photo. Fields the photo lacks are absent. */
export interface PickedPhoto {
  /** File name, for messages. */
  name?: string;
  /** EXIF DateTimeOriginal, `yyyy:MM:dd HH:mm:ss`, local time where it was taken. */
  dateTimeOriginal?: string;
  /** EXIF OffsetTimeOriginal, e.g. `-07:00`. */
  offsetTimeOriginal?: string;
  /** EXIF GPS date and time (UTC), as epoch milliseconds. */
  gpsTimestamp?: number;
  latitude?: number;
  longitude?: number;
  /** Metres above sea level. */
  altitude?: number;
  /** EXIF GPSHPositioningError, in metres. */
  accuracy?: number;
  /** The distinct QR code payloads found in the image. */
  codes: string[];
  /** Set when the photo couldn't be read. */
  error?: string;
}

/**
 * The app's own native plugin (`PhotoImportPlugin` in the iOS and Android
 * projects). Opens the system picker for one or more photos, then reads each
 * one's metadata and looks for QR codes in it. Not available on web.
 */
interface PhotoImportPlugin {
  /** Resolves with no photos if the user cancels. */
  pickPhotos(): Promise<{ photos: PickedPhoto[] }>;
  /** Sent after the picker closes, before each photo is read. */
  addListener(
    event: 'importProgress',
    listener: (progress: { done: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export const PhotoImport = registerPlugin<PhotoImportPlugin>('PhotoImport');

/** A photo that can become a reading (`code` empty if it has no QR code), or why it can't. */
export type PhotoReading = { fix: Fix; code: string } | { problem: string };

export function photoReading(p: PickedPhoto): PhotoReading {
  if (p.error) return { problem: `couldn't be read (${p.error})` };
  if (p.codes.length > 1) return { problem: 'more than one QR code' };
  // A photo without a QR code still gives a time and place; its ID is left empty.
  const code = p.codes[0] ?? '';
  if (code.length > MAX_CODE_LENGTH) {
    return { problem: `QR code is longer than ${MAX_CODE_LENGTH} characters` };
  }
  if (p.latitude == null || p.longitude == null) return { problem: 'no location in the photo' };
  const recordedAt = captureTime(p);
  if (recordedAt == null) return { problem: 'no date in the photo' };
  return {
    code,
    fix: {
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy ?? null,
      altitude: p.altitude ?? null,
      recordedAt,
    },
  };
}

// When the photo was taken. Its EXIF date has no time zone of its own, so
// prefer it with its offset, then the GPS time (UTC), and only then read it
// as local time here, which is wrong if the photo was taken in another zone.
function captureTime(p: PickedPhoto): number | null {
  const m = p.dateTimeOriginal?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (m && p.offsetTimeOriginal && /^[+-]\d{2}:\d{2}$/.test(p.offsetTimeOriginal)) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${p.offsetTimeOriginal}`);
    if (!Number.isNaN(t)) return t;
  }
  if (p.gpsTimestamp != null) return p.gpsTimestamp;
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return null;
}
