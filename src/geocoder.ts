/**
 * Reverse geocoding, independent of any particular service. The app depends
 * only on these types; `nominatim.ts` is the current implementation. See
 * dev-docs/reverse-geocoding.md.
 */

/** What a reverse-geocoding service knows about a spot. */
export interface Place {
  /** Short text for labels, e.g. "US-AZ, Pima Co."; null if the service has no name here. */
  region: string | null;
  /** Which service produced `details`, e.g. "nominatim". */
  source: string;
  /** The service's full result, kept as-is for export. Its shape depends on `source`. */
  details: unknown;
}

export interface ReverseGeocoder {
  /**
   * Resolves when the place is known (including "nothing here", which resolves
   * with `region: null`). Rejects if the lookup couldn't be done (offline, service error).
   * Safe to call many times at once; the implementation decides when each request runs.
   */
  lookup(latitude: number, longitude: number): Promise<Place>;
}
