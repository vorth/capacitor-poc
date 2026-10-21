import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import type { Position } from '@capacitor/geolocation';

/** A persisted location reading, as stored in the `readings` table. */
export interface Reading {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  /** Metres; null when the device does not report altitude. */
  altitude: number | null;
  /** Epoch milliseconds, from Position.timestamp. */
  recordedAt: number;
  /** The ID scanned from the QR code at this location; at most MAX_CODE_LENGTH characters. */
  code: string;
  /** Free text entered by the user; null when left blank. */
  locality: string | null;
  /** Second line of the locality; null when left blank. */
  locality2: string | null;
  /** Free text entered by the user; null when left blank. */
  taxon: string | null;
  /** Who collected the specimen; null when left blank. */
  collector: string | null;
}

/** The user-supplied fields of a reading, saved alongside its location fix. */
export type ReadingDetails = Pick<Reading, 'code' | 'locality' | 'locality2' | 'taxon' | 'collector'>;

/** The persistence surface the app depends on. Backed by SQLite natively, stubbed on web. */
export interface ReadingsStore {
  init(): Promise<void>;
  insertReading(pos: Position, details: ReadingDetails): Promise<void>;
  getReadings(limit?: number, offset?: number): Promise<Reading[]>;
  getReadingCount(): Promise<number>;
  deleteReadings(ids: number[]): Promise<void>;
}

const DB_NAME = 'readings';
const DB_VERSION = 1;

/** Longest ID we accept from a scanned QR code. */
export const MAX_CODE_LENGTH = 25;

// Versioned schema. Until the first release, edit version 1 in place (and
// reinstall the app to recreate the database). After that, add migrations as
// new { toVersion, statements } entries and bump DB_VERSION — never edit an
// existing entry.
const UPGRADE_STATEMENTS = [
  {
    toVersion: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS readings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude    REAL    NOT NULL,
        longitude   REAL    NOT NULL,
        accuracy    REAL    NOT NULL,
        altitude    REAL,
        recorded_at INTEGER NOT NULL,
        code        TEXT    NOT NULL CHECK (length(code) <= ${MAX_CODE_LENGTH}),
        locality    TEXT,
        locality2   TEXT,
        taxon       TEXT,
        collector   TEXT
      );`,
      `CREATE INDEX IF NOT EXISTS idx_readings_recorded_at
         ON readings(recorded_at);`,
    ],
  },
];

interface ReadingRow {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  recorded_at: number;
  code: string;
  locality: string | null;
  locality2: string | null;
  taxon: string | null;
  collector: string | null;
}

function rowToReading(r: ReadingRow): Reading {
  return {
    id: r.id,
    latitude: r.latitude,
    longitude: r.longitude,
    accuracy: r.accuracy,
    altitude: r.altitude,
    recordedAt: r.recorded_at,
    code: r.code,
    locality: r.locality,
    locality2: r.locality2,
    taxon: r.taxon,
    collector: r.collector,
  };
}

/** Real SQLite-backed store for native (iOS/Android) platforms. */
class SqliteReadingsStore implements ReadingsStore {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;

  async init(): Promise<void> {
    await this.sqlite.addUpgradeStatement(DB_NAME, UPGRADE_STATEMENTS);

    // Reuse an existing connection if one is already open (e.g. hot reload).
    const isConn = (await this.sqlite.isConnection(DB_NAME, false)).result;
    this.db = isConn
      ? await this.sqlite.retrieveConnection(DB_NAME, false)
      : await this.sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);

    await this.db.open();
  }

  private conn(): SQLiteDBConnection {
    if (!this.db) throw new Error('ReadingsStore not initialized — call init() first.');
    return this.db;
  }

  async insertReading(pos: Position, details: ReadingDetails): Promise<void> {
    const c = pos.coords;
    await this.conn().run(
      `INSERT INTO readings
         (latitude, longitude, accuracy, altitude, recorded_at, code, locality, locality2, taxon, collector)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        c.latitude,
        c.longitude,
        c.accuracy,
        c.altitude ?? null,
        pos.timestamp,
        details.code,
        details.locality,
        details.locality2,
        details.taxon,
        details.collector,
      ],
    );
  }

  async getReadings(limit = 10, offset = 0): Promise<Reading[]> {
    const res = await this.conn().query(
      `SELECT id, latitude, longitude, accuracy, altitude, recorded_at, code, locality, locality2, taxon, collector
         FROM readings
         ORDER BY recorded_at DESC
         LIMIT ? OFFSET ?;`,
      [limit, offset],
    );
    return ((res.values ?? []) as ReadingRow[]).map(rowToReading);
  }

  async getReadingCount(): Promise<number> {
    const res = await this.conn().query(`SELECT COUNT(*) AS n FROM readings;`);
    return ((res.values?.[0] as { n: number } | undefined)?.n) ?? 0;
  }

  async deleteReadings(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(', ');
    await this.conn().run(`DELETE FROM readings WHERE id IN (${placeholders});`, ids);
  }
}

/**
 * In-memory stub used on web so `npm run dev` runs without the jeep-sqlite/wasm
 * setup. Data does NOT persist across reloads. Swap for a jeep-sqlite-backed
 * store if real browser persistence is needed for a demo.
 */
class WebStubReadingsStore implements ReadingsStore {
  private rows: Reading[] = [];
  private nextId = 1;

  async init(): Promise<void> {
    console.warn(
      '[db] Using in-memory web stub — readings will not persist across reloads. ' +
        'Native builds (iOS/Android) use SQLite.',
    );
  }

  async insertReading(pos: Position, details: ReadingDetails): Promise<void> {
    const c = pos.coords;
    this.rows.push({
      id: this.nextId++,
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: c.accuracy,
      altitude: c.altitude ?? null,
      recordedAt: pos.timestamp,
      ...details,
    });
  }

  async getReadings(limit = 10, offset = 0): Promise<Reading[]> {
    return [...this.rows]
      .sort((a, b) => b.recordedAt - a.recordedAt)
      .slice(offset, offset + limit);
  }

  async getReadingCount(): Promise<number> {
    return this.rows.length;
  }

  async deleteReadings(ids: number[]): Promise<void> {
    const doomed = new Set(ids);
    this.rows = this.rows.filter((r) => !doomed.has(r.id));
  }
}

let store: ReadingsStore | null = null;

/** Returns the singleton store, initializing it on first call. */
export async function getStore(): Promise<ReadingsStore> {
  if (store) return store;
  store = Capacitor.isNativePlatform()
    ? new SqliteReadingsStore()
    : new WebStubReadingsStore();
  await store.init();
  return store;
}
