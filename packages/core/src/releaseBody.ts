import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RELEASE_BODY_LIMIT = 125_000;
const TRUNCATION_NOTE = '…(truncated; see CHANGELOG.md for the full list)';

function capReleaseBody(body: string): { body: string; truncated: boolean } {
  if (body.length <= RELEASE_BODY_LIMIT) {
    return { body, truncated: false };
  }
  const separator = '\n\n';
  const budget = RELEASE_BODY_LIMIT - TRUNCATION_NOTE.length - separator.length;
  const lineBreak = body.lastIndexOf('\n', budget);
  const kept = body.slice(0, lineBreak > 0 ? lineBreak : budget).trimEnd();
  return { body: `${kept}${separator}${TRUNCATION_NOTE}`, truncated: true };
}

/**
 * Writes a release body for `gh --notes-file`, since one large argument can exceed the OS's per-argument limit. A body
 * over GitHub's 125,000-character limit is cut at a line break and ends with a note.
 */
export function writeReleaseNotesFile(body: string): { path: string; truncated: boolean; cleanup: () => void } {
  const capped = capReleaseBody(body);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'releasekit-notes-'));
  const notesPath = path.join(dir, 'notes.md');
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    fs.writeFileSync(notesPath, capped.body, 'utf-8');
  } catch (error) {
    cleanup();
    throw error;
  }
  return { path: notesPath, truncated: capped.truncated, cleanup };
}
