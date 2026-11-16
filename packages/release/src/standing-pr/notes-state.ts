import { createHash } from 'node:crypto';
import type { NotesConfig } from '@releasekit/config';
import type { VersionOutput, VersionPackageChangelog } from '@releasekit/core';
import { renderedRegionText, truncatePackageNotes } from './notes-region.js';

/** What the update last wrote into a key's notes region, so a later run can tell it from a human edit. */
export interface NotesRegionState {
  /** `changelogInputHash` of the key when its notes were generated. */
  inputHash: string;
  /** `regionTextHash` of the text as rendered into the region. */
  renderedHash: string;
  truncated?: boolean;
}

export type NotesRegionStates = Record<string, NotesRegionState>;

// Short, as the manifest shares one comment's size limit; telling an edit apart needs no collision resistance.
function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Changes when anything that shapes the text generated from a changelog key does: its versions, its entries, or the
 * generating `config`.
 */
export function changelogInputHash(changelog: VersionPackageChangelog, config: unknown): string {
  const { version, previousVersion, entries } = changelog;
  return shortHash(JSON.stringify({ version, previousVersion, entries, config }));
}

/** Keyed like the notes regions. */
export function releaseNotesInputHashes(
  versionOutput: VersionOutput,
  notesConfig: NotesConfig | undefined,
): Record<string, string> {
  const releaseNotes = notesConfig?.releaseNotes;
  // The hash lands in a public comment, and the key shapes no text.
  const config = releaseNotes
    ? { ...releaseNotes, llm: releaseNotes.llm && { ...releaseNotes.llm, apiKey: undefined } }
    : releaseNotes;
  return Object.fromEntries(versionOutput.changelogs.map((cl) => [cl.packageName, changelogInputHash(cl, config)]));
}

/** Writes each shipped region where the notes pipeline writes a per-version notes file. */
export async function writeRegionNotesFiles(
  regions: Record<string, string>,
  versionOutput: VersionOutput,
  notesConfig: NotesConfig | undefined,
): Promise<string[]> {
  const dir = notesConfig?.releaseNotes ? notesConfig.releaseNotes.file?.dir : undefined;
  const shipped = versionOutput.changelogs.filter((cl) => Object.hasOwn(regions, cl.packageName));
  if (!dir || shipped.length === 0) {
    return [];
  }
  const { nestsReleaseNotes, writeVersionedNotes } = await import('@releasekit/notes');
  const nested = nestsReleaseNotes(versionOutput.changelogs.length);
  return writeVersionedNotes(shipped, dir, false, nested, (cl) => regions[cl.packageName] ?? '');
}

/** GitHub's web editor saves the whole body with CRLF line endings. */
export function normalizeRegionText(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

export function regionTextHash(text: string): string {
  return shortHash(normalizeRegionText(text));
}

export function notesRegionState(key: string, notes: string, inputHash: string): NotesRegionState {
  const truncated = truncatePackageNotes(notes) !== notes;
  return {
    inputHash,
    renderedHash: regionTextHash(renderedRegionText(key, notes) ?? ''),
    ...(truncated ? { truncated } : {}),
  };
}

function isUnedited(text: string, state: NotesRegionState | undefined): state is NotesRegionState {
  return state !== undefined && regionTextHash(text) === state.renderedHash;
}

export interface NotesRegionPlan {
  /** Keys with no region, or with an unedited one whose inputs changed. */
  generate: string[];
  /** State of the unedited regions. An edited region, or one without state, has none and is kept as written. */
  owned: NotesRegionStates;
}

export function planNotesRegions(
  keys: string[],
  regions: Record<string, string>,
  states: NotesRegionStates | undefined,
  inputHashes: Record<string, string>,
): NotesRegionPlan {
  const plan: NotesRegionPlan = { generate: [], owned: {} };
  for (const key of keys) {
    const text = regions[key];
    const state = states?.[key];
    if (text === undefined) {
      plan.generate.push(key);
    } else if (isUnedited(text, state)) {
      plan.owned[key] = state;
      if (state.inputHash !== inputHashes[key]) {
        plan.generate.push(key);
      }
    }
  }
  return plan;
}

/**
 * The regions publish can ship as written: all but an unedited one that was truncated or whose inputs changed since
 * it was generated, as when its regeneration failed.
 */
export function publishableNotesRegions(
  regions: Record<string, string>,
  states: NotesRegionStates | undefined,
  inputHashes: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(regions).filter(([key, text]) => {
      const state = states?.[key];
      return !(isUnedited(text, state) && (state.truncated || state.inputHash !== inputHashes[key]));
    }),
  );
}
