import type { Reading } from './db';

export type ExportFormat = 'json' | 'csv';

const pad = (n: number) => String(n).padStart(2, '0');

// Local date as `yyyy-mm-dd` and time as `hh:mm` (24-hour).
export function localDateTime(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export const formatReading = (r: Reading) => localDateTime(r.recordedAt);

// ISO 8601 in local time with the UTC offset, e.g. 2026-10-24T14:32:05-07:00.
function localTimestamp(ms: number): string {
  const d = new Date(ms);
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

// Same precision as the inspector and labels.
const coord = (x: number) => Number(x.toFixed(5));

// One object per reading; null fields are left out. `revGeocode` is the
// geocoding service's whole response (it carries the OSM licence notice).
export function toJSON(readings: Reading[]): string {
  const records = readings.map((r) => {
    const { date, time } = formatReading(r);
    const record: Record<string, unknown> = {
      id: r.code,
      timestamp: localTimestamp(r.recordedAt),
      date,
      time,
      latitude: coord(r.latitude),
      longitude: coord(r.longitude),
      accuracy: Math.round(r.accuracy),
      altitude: r.altitude != null ? Math.round(r.altitude) : null,
      region: r.region,
      locality: r.locality,
      locality2: r.locality2,
      taxon: r.taxon,
      collector: r.collector,
      revGeocode: r.place?.details ?? null,
    };
    for (const key of Object.keys(record)) {
      if (record[key] == null) delete record[key];
    }
    return record;
  });
  return JSON.stringify(records, null, 2);
}

const CSV_COLUMNS = [
  'id',
  'date',
  'time',
  'latitude',
  'longitude',
  'accuracy_m',
  'altitude_m',
  'region',
  'locality',
  'locality2',
  'taxon',
  'collector',
];

// RFC 4180: quote fields containing a comma, quote or line break, doubling quotes.
function csvField(value: string | number | null): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(readings: Reading[]): string {
  const rows = readings.map((r) => {
    const { date, time } = formatReading(r);
    return [
      r.code,
      date,
      time,
      r.latitude.toFixed(5),
      r.longitude.toFixed(5),
      Math.round(r.accuracy),
      r.altitude != null ? Math.round(r.altitude) : null,
      r.region,
      r.locality,
      r.locality2,
      r.taxon,
      r.collector,
    ].map(csvField);
  });
  return [CSV_COLUMNS, ...rows].map((row) => row.join(',')).join('\r\n') + '\r\n';
}

// File name for a download, e.g. checkrspot-2026-10-25-1432.csv.
export function exportFilename(format: ExportFormat): string {
  const { date, time } = localDateTime(Date.now());
  return `checkrspot-${date}-${time.replace(':', '')}.${format}`;
}
