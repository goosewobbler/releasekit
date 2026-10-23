/** Bodies are untrusted, so this slices with `indexOf`: a backtracking regex would be a ReDoS risk. */
function sliceBetween(body: string, open: string, close: string, restIfNoClose: boolean): string | undefined {
  const start = body.indexOf(open);
  if (start === -1) {
    return undefined;
  }
  const from = start + open.length;
  const end = body.indexOf(close, from);
  if (end === -1) {
    return restIfNoClose ? body.slice(from).trim() : undefined;
  }
  return body.slice(from, end).trim();
}

export interface MarkerData<T> {
  encode(value: T): string;
  /** Null when the marker is absent or malformed. */
  decode(body: string): T | null;
}

export function markerData<T>(opts: {
  /** Opening token, e.g. `<!-- releasekit-publish-failure-data:`. */
  open: string;
  close?: string;
  serialize: (value: T) => string;
  deserialize: (payload: string) => T | null;
}): MarkerData<T> {
  // The spaces make the opener specific: `<!-- base64 ` won't latch onto a stray `<!-- base64url …` marker.
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

/**
 * Untrusted region content can smuggle a forged marker: a `<!-- releasekit-notes-end:pkg -->` truncates the region on
 * the next round-trip, a sibling opener hijacks another package's notes, and the bare `<!-- releasekit-notes -->`
 * spoofs the GitHub-release ownership check. The lookahead never consumes past the fixed `<!--`, so the scan stays
 * linear.
 */
export function neutralizeMarkers(content: string): string {
  return content.replace(/<!--(?= ?(?:releasekit-|rk-))/g, '&lt;!--');
}

export function wrapMarkerRegion(content: string, open: string, close: string): string {
  return `${open}\n\n${content.trim()}\n\n${close}`;
}

/** Legacy bodies carry only the opener, so a missing closer yields everything after it. */
export function extractMarkerRegion(body: string, open: string, close: string): string | undefined {
  return sliceBetween(body, open, close, true);
}
