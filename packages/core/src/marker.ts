/**
 * Codecs for machine state carried in HTML-comment markers inside round-trippable surfaces (PR
 * comments, PR/release bodies). One place owns the AGENTS.md invariant: machine state lives behind
 * its own marker and is read by slicing fixed delimiters — never by parsing the human-facing prose,
 * and never with a backtracking regex (which is a ReDoS risk on untrusted bodies).
 *
 * Two shapes:
 * - {@link markerData} — a single typed datum on one `<!-- open payload close -->` line (e.g. a
 *   status flag, a JSON headline, a base64 blob).
 * - {@link extractMarkerRegion} / {@link wrapMarkerRegion} — a span of editable content delimited by
 *   a distinct open/close marker pair (e.g. an editable release-notes region, a selection block).
 */

/** Linear extract of the trimmed text between `open` and `close`. */
function sliceBetween(body: string, open: string, close: string, restIfNoClose: boolean): string | undefined {
  const start = body.indexOf(open);
  if (start === -1) return undefined;
  const from = start + open.length;
  const end = body.indexOf(close, from);
  if (end === -1) return restIfNoClose ? body.slice(from).trim() : undefined;
  return body.slice(from, end).trim();
}

/** A typed datum carried in its own HTML-comment marker. */
export interface MarkerData<T> {
  /** Render the value as a `<!-- open payload close -->` marker line. */
  encode(value: T): string;
  /** Extract and parse the payload from a body, or null when the marker is absent/malformed. */
  decode(body: string): T | null;
}

/**
 * Build a codec for a single typed datum living behind its own marker. The payload is whatever sits
 * between `open` and `close`; `serialize`/`deserialize` map it to/from `T`. `deserialize` returns
 * null to reject a malformed payload (the caller decides whether that means "absent" or an error).
 */
export function markerData<T>(opts: {
  /** Opening token, e.g. `<!-- releasekit-publish-failure-data:`. */
  open: string;
  /** Closing token; defaults to the HTML-comment terminator. */
  close?: string;
  serialize: (value: T) => string;
  deserialize: (payload: string) => T | null;
}): MarkerData<T> {
  // The marker format is `<open> <payload> <close>` (space-separated). Bake those spaces into the
  // delimiters so the opening match is specific: `<!-- base64 ` won't latch onto a stray
  // `<!-- base64url …` marker (preserving the old regex's specificity without a regex).
  const open = `${opts.open} `;
  const close = ` ${opts.close ?? '-->'}`;
  return {
    encode(value) {
      return `${open}${opts.serialize(value)}${close}`;
    },
    decode(body) {
      const payload = sliceBetween(body, open, close, false);
      return payload === undefined ? null : opts.deserialize(payload);
    },
  };
}

/** Wrap editable content in an open/close marker pair so it can be recognised and extracted later. */
export function wrapMarkerRegion(content: string, open: string, close: string): string {
  return `${open}\n\n${content.trim()}\n\n${close}`;
}

/**
 * Extract the content of an open/close-delimited region, or undefined when the opener is absent.
 * Pure marker slicing — never interprets the prose. When the closer is missing (a legacy body that
 * only carried the opener), returns everything after the opener so older bodies still round-trip.
 */
export function extractMarkerRegion(body: string, open: string, close: string): string | undefined {
  return sliceBetween(body, open, close, true);
}
