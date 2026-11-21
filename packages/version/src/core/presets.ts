import type { Preset } from '@releasekit/config';
import createAngularPreset from 'conventional-changelog-angular';
import createConventionalCommitsPreset from 'conventional-changelog-conventionalcommits';
import { filterRevertedCommitsSync } from 'conventional-commits-filter';
import type { Commit } from 'conventional-commits-parser';
import type { Preset as BumperPreset } from 'conventional-recommended-bump';

const HEADER_PATTERN = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/;
const BREAKING_HEADER_PATTERN = /^(\w+)(?:\(([^)]+)\))?!: (.+)$/;
const REVERTED_HASH_PATTERN = /^This reverts commit (\w{7,40})\b/m;

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
  return {
    ...preset,
    parser: {
      ...preset.parser,
      headerPattern: HEADER_PATTERN,
      breakingHeaderPattern: BREAKING_HEADER_PATTERN,
      // The bump's git log appends only a `-hash-` field. The parser's default pattern would read any `-word-`
      // body line as a field marker, swallowing the lines after it or throwing on `-notes-`.
      fieldPattern: /^-(hash)-$/,
    },
    commits: { ...preset.commits, filterReverts: false },
    // conventionalcommits' whatBump re-reads `!` from the raw header with its own greedy scope pattern. The
    // parser has already turned a `!` header into a note, so hiding the header leaves the parse to decide.
    whatBump: (commits) =>
      preset.whatBump(
        filterRevertedCommits(commits, (commit) => commit).map((commit) => ({ ...commit, header: null }) as Commit),
      ),
  };
}

/**
 * Drops each commit reverted in `items`, newest first, along with its revert. The bump and the changelog both filter
 * with it. `commitOf` gives an item's parsed commit, with its `hash` set.
 */
export function filterRevertedCommits<T>(items: Iterable<T>, commitOf: (item: T) => RevertFields): T[] {
  const keyed = [...items].map((item) => {
    const commit = commitOf(item);
    return { item, header: commit.header, hash: commit.hash, revert: commit.revert ?? reappliedRevert(commit) };
  });
  return [...filterRevertedCommitsSync(keyed)].map(({ item }) => item);
}

/**
 * Git titles a revert of `Revert "<subject>"` as `Reapply "<subject>"`, which the presets' `revertPattern` doesn't
 * match. It reverts the commit it names, whose header has `Revert` in place of `Reapply`.
 */
function reappliedRevert({ header, body, footer }: RevertFields): Commit['revert'] {
  if (!header?.startsWith('Reapply "')) {
    return null;
  }
  const hash = `${body ?? ''}\n${footer ?? ''}`.match(REVERTED_HASH_PATTERN)?.[1];
  return hash ? { header: `Revert${header.slice('Reapply'.length)}`, hash } : null;
}
