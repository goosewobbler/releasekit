export interface MarkerRegion {
  content: string;
  /** False when no closer follows the opener; `content` is then everything after the opener. */
  closed: boolean;
}

/** Bodies are untrusted, so this slices with `indexOf`: a backtracking regex would be a ReDoS risk. */
export function extractMarkerRegion(body: string, open: string, close: string): MarkerRegion | undefined {
  const start = body.indexOf(open);
  if (start === -1) {
    return undefined;
  }
  const from = start + open.length;
  const end = body.indexOf(close, from);
  if (end === -1) {
    return { content: body.slice(from).trim(), closed: false };
  }
  return { content: body.slice(from, end).trim(), closed: true };
}

/**
 * Like {@link extractMarkerRegion}, but the opener and closer count only as a whole line, so a marker copied into the
 * content can't end the region early. Line endings and the whitespace around each marker line are ignored, as GitHub's
 * editor may change them.
 */
export function extractLineMarkerRegion(body: string, open: string, close: string): MarkerRegion | undefined {
  const lines = body.replaceAll('\r', '').split('\n');
  const start = lines.findIndex((line) => line.trim() === open);
  if (start === -1) {
    return undefined;
  }
  const end = lines.findIndex((line, i) => i > start && line.trim() === close);
  const closed = end !== -1;
  const content = lines.slice(start + 1, closed ? end : undefined).join('\n');
  return { content: content.trim(), closed };
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
      const payload = extractMarkerRegion(body, open, close);
      return payload?.closed ? opts.deserialize(payload.content) : null;
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

// Single-backtick spans only, as in the mention regex, and not from a backtick after an odd run of backslashes, which
// escapes it. GitHub doesn't decode `&lt;` in a code span, so a zero-width space breaks the opener there instead.
const CODE_SPAN_OR_COMMENT_OPEN = /(?<!(?<!\\)\\(?:\\\\)*)`[^`]*`|<!--/g;

/**
 * Escapes every opener, not just releasekit markers: in commit text, any `<!--` hides the body up to the next `-->`.
 * Hand-written notes use {@link neutralizeMarkers}, as people write comments in them on purpose. Code spans are escaped
 * too: a marker inside one still matches the body parsers.
 */
export function escapeCommentOpeners(text: string): string {
  return text.replace(CODE_SPAN_OR_COMMENT_OPEN, (match) =>
    match.startsWith('`') ? match.replaceAll('<!--', '<!\u200B--') : '&lt;!--',
  );
}

export function wrapMarkerRegion(content: string, open: string, close: string): string {
  return `${open}\n\n${content.trim()}\n\n${close}`;
}
