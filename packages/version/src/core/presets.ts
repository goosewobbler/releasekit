import type { Preset } from '@releasekit/config';
import createAngularPreset from 'conventional-changelog-angular';
import createConventionalCommitsPreset from 'conventional-changelog-conventionalcommits';
import { filterRevertedCommitsSync } from 'conventional-commits-filter';
import { type Commit, CommitParser } from 'conventional-commits-parser';
import type { Preset as BumperPreset } from 'conventional-recommended-bump';

const HEADER_PATTERN = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/;
const BREAKING_HEADER_PATTERN = /^(\w+)(?:\(([^)]+)\))?!: (.+)$/;
const REVERTED_HASH_PATTERN = /^This reverts commit (\w+)/gm;
const REVERT_LAYER_PATTERN = /^(Revert|Reapply) "(.*)"$/;
const SQUASH_SUFFIX_PATTERN = /(?: \(#\d+\))+$/;

type RevertFields = Pick<Commit, 'header' | 'body' | 'footer' | 'revert'> & { hash?: string | null };

function createAngularPresetWithSpecNoteKeywords(): BumperPreset {
  const preset = (createAngularPreset as () => BumperPreset)();
  return {
    ...preset,
    parser: { ...preset.parser, noteKeywords: [...(preset.parser?.noteKeywords ?? []), 'BREAKING-CHANGE'] },
  };
}

// Imported statically so they resolve from releasekit's own dependencies in any install layout, bundled dist included.
const PRESETS: Record<Preset, () => BumperPreset> = {
  angular: createAngularPresetWithSpecNoteKeywords,
  conventionalcommits: createConventionalCommitsPreset as () => BumperPreset,
};

/** The preset with releasekit's header rules. The bump and the changelog both parse with its `parser`. */
export function createPreset(name: Preset): BumperPreset {
  const preset = PRESETS[name]();
  const parser = {
    ...preset.parser,
    headerPattern: HEADER_PATTERN,
    breakingHeaderPattern: BREAKING_HEADER_PATTERN,
    // The bump's git log marks only `-hash-`, and the default pattern reads any `-word-` body line as a field marker.
    fieldPattern: /^-(hash)-$/,
  };
  const commitParser = new CommitParser(parser);
  return {
    ...preset,
    parser,
    commits: { ...preset.commits, filterReverts: false },
    // conventionalcommits' whatBump re-reads `!` from the raw header with its own greedy scope pattern. The
    // parser has already turned a `!` header into a note, so hiding the header leaves the parse to decide.
    whatBump: (commits) =>
      preset.whatBump(
        resolveReverts(commits, (commit) => commit, commitParser).map(
          ({ commit }) => ({ ...commit, header: null }) as Commit,
        ),
      ),
  };
}

/**
 * Drops each commit that a revert in `items` (newest first) undoes, along with the revert, and treats `Reapply "X"` as
 * `X` when its revert isn't in `items`, so it bumps like the original change. Returns the items left with their
 * commits. `commitOf` must return the item's parsed commit with its `hash`.
 */
export function resolveReverts<T, C extends RevertFields>(
  items: Iterable<T>,
  commitOf: (item: T) => C,
  parser: CommitParser,
): Array<{ item: T; commit: C }> {
  const keyed = [...items].map((item) => {
    const commit = commitOf(item);
    const reverting = revertOf(commit);
    // Pairs by hash alone, since a squash merge's ` (#N)` suffix breaks the preset's title match.
    const revert = reverting ? { hash: reverting.hash } : commit.revert;
    return { item, commit, reverting, header: commit.header, hash: commit.hash, revert };
  });
  return [...filterRevertedCommitsSync(keyed)].map(({ item, commit, reverting }) => {
    if (!reverting?.reapply) {
      return { item, commit };
    }
    const message = [reverting.subject, commit.body, commit.footer].filter(Boolean).join('\n\n');
    return { item, commit: { ...commit, ...parser.parse(message) } as C };
  });
}

/** A revert or reapply that names the commit it undoes, with the subject it wraps. */
function revertOf({ header, body, footer }: RevertFields): { hash: string; subject: string; reapply: boolean } | null {
  const { subject, reverts } = unwrapReverts(header ?? '');
  if (reverts === 0) {
    return null;
  }
  // A squash of several reverts names several commits, which one hash can't pair, so it keeps the preset's matching.
  const hashes = [...`${body ?? ''}\n${footer ?? ''}`.matchAll(REVERTED_HASH_PATTERN)].map((match) => match[1]);
  return hashes.length === 1 ? { hash: hashes[0], subject, reapply: reverts % 2 === 0 } : null;
}

/** `Reapply` is git's title for a revert of a revert, so it counts as two: an even count means the change is back. */
function unwrapReverts(header: string): { subject: string; reverts: number } {
  let subject = header;
  let reverts = 0;
  for (;;) {
    const match = subject.replace(SQUASH_SUFFIX_PATTERN, '').match(REVERT_LAYER_PATTERN);
    if (!match) {
      return { subject, reverts };
    }
    reverts += match[1] === 'Reapply' ? 2 : 1;
    subject = match[2];
  }
}
