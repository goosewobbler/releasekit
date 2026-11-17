import type { Preset } from '@releasekit/config';
import createAngularPreset from 'conventional-changelog-angular';
import createConventionalCommitsPreset from 'conventional-changelog-conventionalcommits';
import type { Commit } from 'conventional-commits-parser';
import type { Preset as BumperPreset } from 'conventional-recommended-bump';

const HEADER_PATTERN = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/;
const BREAKING_HEADER_PATTERN = /^(\w+)(?:\(([^)]+)\))?!: (.+)$/;

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
    // conventionalcommits' whatBump re-reads `!` from the raw header with its own greedy scope pattern. The
    // parser has already turned a `!` header into a note, so hiding the header leaves the parse to decide.
    whatBump: (commits) => preset.whatBump(commits.map((commit) => ({ ...commit, header: null }) as Commit)),
  };
}
