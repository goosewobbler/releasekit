import type { Preset } from '@releasekit/config';
import createAngularPreset from 'conventional-changelog-angular';
import createConventionalCommitsPreset from 'conventional-changelog-conventionalcommits';
import { filterRevertedCommitsSync } from 'conventional-commits-filter';
import { type Commit, CommitParser } from 'conventional-commits-parser';
import type { Preset as BumperPreset } from 'conventional-recommended-bump';

const HEADER_PATTERN = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/;
const BREAKING_HEADER_PATTERN = /^(\w+)(?:\(([^)]+)\))?!: (.+)$/;
const REVERTED_HASH_PATTERN = /^This reverts commit (\w+)/m;
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
    // The bump's git log appends only a `-hash-` field. The parser's default pattern would read any `-word-`
    // body line as a field marker, swallowing the lines after it or throwing on `-notes-`.
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
        filterRevertedCommits(commits, (commit) => commit).map(
          (commit) => ({ ...asReapplied(commit, commitParser), header: null }) as Commit,
        ),
      ),
  };
}

/**
 * Drops each commit that a revert in `items` (newest first) undoes, and the revert with it. `commitOf` must return the
 * item's parsed commit with its `hash`.
 */
export function filterRevertedCommits<T>(items: Iterable<T>, commitOf: (item: T) => RevertFields): T[] {
  const keyed = [...items].map((item) => {
    const commit = commitOf(item);
    return { item, header: commit.header, hash: commit.hash, revert: revertOf(commit) ?? commit.revert };
  });
  return [...filterRevertedCommitsSync(keyed)].map(({ item }) => item);
}

/**
 * Parses a reapply whose revert shipped in an earlier release as the commit it reapplies. Run it after
 * `filterRevertedCommits`, which drops a reapply whose revert is in the range.
 */
export function asReapplied(commit: Commit, parser: CommitParser): Commit {
  const { subject, reverts } = unwrapReverts(commit.header ?? '');
  if (!isReapply(reverts) || !revertOf(commit)) {
    return commit;
  }
  const message = [subject, commit.body, commit.footer].filter(Boolean).join('\n\n');
  return { ...commit, ...parser.parse(message) };
}

/**
 * Peels `Revert "…"` and `Reapply "…"` titles, and the ` (#N)` suffixes squash merges append, down to the subject.
 * Git titles a revert of a revert `Reapply`, so it counts twice: an even count means the change is back.
 */
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

function isReapply(reverts: number): boolean {
  return reverts > 0 && reverts % 2 === 0;
}

/** Pairs a reapply with the revert it undoes by hash alone, since squash merges change the titles git quotes. */
function revertOf({ header, body, footer }: RevertFields): Commit['revert'] {
  if (!isReapply(unwrapReverts(header ?? '').reverts)) {
    return null;
  }
  const hash = `${body ?? ''}\n${footer ?? ''}`.match(REVERTED_HASH_PATTERN)?.[1];
  return hash ? { hash } : null;
}
