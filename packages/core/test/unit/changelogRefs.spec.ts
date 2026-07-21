import { describe, expect, it } from 'vitest';
import {
  escapeChangelogMentions,
  neutralizeDescriptionRefs,
  parseGitHubOwnerRepo,
  renderIssueRefs,
} from '../../src/changelogRefs.js';

describe('parseGitHubOwnerRepo', () => {
  it('should parse an HTTPS GitHub URL', () => {
    expect(parseGitHubOwnerRepo('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should strip a trailing .git suffix', () => {
    expect(parseGitHubOwnerRepo('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should parse an SCP-style SSH URL', () => {
    expect(parseGitHubOwnerRepo('git@github.com:owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('should return null for a non-GitHub host', () => {
    expect(parseGitHubOwnerRepo('https://gitlab.com/owner/repo')).toBeNull();
  });

  it('should return null for an unparseable input', () => {
    expect(parseGitHubOwnerRepo('not a url')).toBeNull();
  });
});

describe('renderIssueRefs', () => {
  const repo = 'https://github.com/octocat/hello';

  it('should render a canonical /issues/ link wrapped in parens in link mode', () => {
    expect(renderIssueRefs(['#481'], 'link', repo)).toBe('([#481](https://github.com/octocat/hello/issues/481))');
  });

  it('should join multiple refs with a comma in link mode', () => {
    expect(renderIssueRefs(['#1', '#2'], 'link', repo)).toBe(
      '([#1](https://github.com/octocat/hello/issues/1), [#2](https://github.com/octocat/hello/issues/2))',
    );
  });

  it('should normalise a bare numeric token without a leading #', () => {
    expect(renderIssueRefs(['481'], 'link', repo)).toBe('([#481](https://github.com/octocat/hello/issues/481))');
  });

  it('should fall back to escape when the repo URL is null in link mode', () => {
    expect(renderIssueRefs(['#481'], 'link', null)).toBe('(\\#481)');
  });

  it('should fall back to escape when the repo URL is non-GitHub in link mode', () => {
    expect(renderIssueRefs(['#481'], 'link', 'https://gitlab.com/o/r')).toBe('(\\#481)');
  });

  it('should render literal escaped refs in escape mode (no link even with a repo URL)', () => {
    expect(renderIssueRefs(['#481', '#7'], 'escape', repo)).toBe('(\\#481, \\#7)');
  });

  it('should return an empty string in strip mode', () => {
    expect(renderIssueRefs(['#481'], 'strip', repo)).toBe('');
  });

  it('should return an empty string when there are no refs', () => {
    expect(renderIssueRefs([], 'link', repo)).toBe('');
  });

  it('should label the PR and closed issues when a prNumber is given in link mode', () => {
    expect(renderIssueRefs(['#503', '#500'], 'link', repo, '#503')).toBe(
      '(PR [#503](https://github.com/octocat/hello/pull/503) · closes [#500](https://github.com/octocat/hello/issues/500))',
    );
  });

  it('should render PR-only (no `· closes`) when there are no closed issues', () => {
    expect(renderIssueRefs(['#503'], 'link', repo, '#503')).toBe(
      '(PR [#503](https://github.com/octocat/hello/pull/503))',
    );
  });

  it('should list every closed issue after the PR', () => {
    expect(renderIssueRefs(['#503', '#500', '#499'], 'link', repo, '#503')).toBe(
      '(PR [#503](https://github.com/octocat/hello/pull/503) · closes [#500](https://github.com/octocat/hello/issues/500), [#499](https://github.com/octocat/hello/issues/499))',
    );
  });

  it('should compare PR vs closed issues by numeric value, with or without a leading #', () => {
    expect(renderIssueRefs(['503', '500'], 'link', repo, '503')).toBe(
      '(PR [#503](https://github.com/octocat/hello/pull/503) · closes [#500](https://github.com/octocat/hello/issues/500))',
    );
  });

  it('should fall back to the plain ref list when a prNumber is given but the repo is non-GitHub', () => {
    expect(renderIssueRefs(['#503', '#500'], 'link', null, '#503')).toBe('(\\#503, \\#500)');
  });

  it('should not label the PR in escape mode even when a prNumber is given', () => {
    expect(renderIssueRefs(['#503', '#500'], 'escape', repo, '#503')).toBe('(\\#503, \\#500)');
  });

  it('should drop the refs in strip mode even when a prNumber is given', () => {
    expect(renderIssueRefs(['#503', '#500'], 'strip', repo, '#503')).toBe('');
  });

  it('should still render a prNumber that is absent from issueIds (never silently dropped)', () => {
    // Defensive: the invariant is prNumber ∈ issueIds, but if a caller omits it the PR must not vanish.
    expect(renderIssueRefs([], 'escape', repo, '#503')).toBe('(\\#503)');
    expect(renderIssueRefs(['#500'], 'escape', repo, '#503')).toBe('(\\#503, \\#500)');
  });
});

describe('escapeChangelogMentions', () => {
  it('should escape a leading @user mention', () => {
    expect(escapeChangelogMentions('Thanks @octocat for the fix')).toBe('Thanks \\@octocat for the fix');
  });

  it('should escape a scoped-package @org/team mention', () => {
    expect(escapeChangelogMentions('Bump @wdio/native-cdp-bridge')).toBe('Bump \\@wdio/native-cdp-bridge');
  });

  it('should escape a mention at the start of the text', () => {
    expect(escapeChangelogMentions('@octocat opened this')).toBe('\\@octocat opened this');
  });

  it('should not mangle an email address', () => {
    expect(escapeChangelogMentions('Contact support@example.com please')).toBe('Contact support@example.com please');
  });

  it('should not touch a mid-word @ (foo@bar)', () => {
    expect(escapeChangelogMentions('handle foo@bar inline')).toBe('handle foo@bar inline');
  });

  it('should not double-escape an already-escaped mention', () => {
    expect(escapeChangelogMentions('see \\@octocat')).toBe('see \\@octocat');
  });

  it('should leave a mention inside an inline code span untouched', () => {
    expect(escapeChangelogMentions('install `@wdio/native-cdp-bridge` now')).toBe(
      'install `@wdio/native-cdp-bridge` now',
    );
  });

  it('should escape a real mention while leaving a code-span mention alone', () => {
    expect(escapeChangelogMentions('ping @octocat about `@wdio/foo`')).toBe('ping \\@octocat about `@wdio/foo`');
  });

  it('should handle adversarial backtick input in linear time (no catastrophic backtracking)', () => {
    // A long run of unmatched backticks would hang a backreference-based code-span regex (ReDoS).
    // The single-backtick pattern is linear, so this returns effectively instantly.
    const start = Date.now();
    const out = escapeChangelogMentions('`'.repeat(100_000));
    expect(out).toContain('`');
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe('neutralizeDescriptionRefs', () => {
  const repo = 'https://github.com/octocat/hello';

  it('should remove a parenthesised ref that is duplicated in the appended label', () => {
    // `(#467)` in the subject-derived description also appears as `closes #467` in the label.
    expect(neutralizeDescriptionRefs('failed queued batch (#467)', ['#475', '#467'], 'link', repo)).toBe(
      'failed queued batch',
    );
  });

  it('should remove a bare duplicated ref without leaving a double space', () => {
    expect(neutralizeDescriptionRefs('reverts #461 behaviour', ['#461'], 'escape', repo)).toBe('reverts behaviour');
  });

  it('should escape a description-only ref in escape mode', () => {
    expect(neutralizeDescriptionRefs('see #999 for context', [], 'escape', repo)).toBe('see \\#999 for context');
  });

  it('should link a description-only ref in link mode', () => {
    expect(neutralizeDescriptionRefs('see #999', [], 'link', repo)).toBe(
      'see [#999](https://github.com/octocat/hello/issues/999)',
    );
  });

  it('should fall back to escape for a description-only ref when the repo is non-GitHub', () => {
    expect(neutralizeDescriptionRefs('see #999', [], 'link', null)).toBe('see \\#999');
  });

  it('should drop every description ref in strip mode', () => {
    expect(neutralizeDescriptionRefs('see #999 and (#467)', [], 'strip', repo)).toBe('see and');
  });

  it('should leave a ref inside an inline code span untouched', () => {
    expect(neutralizeDescriptionRefs('use `#999` literally', [], 'escape', repo)).toBe('use `#999` literally');
  });

  it('should not touch an already-linked or already-escaped ref', () => {
    expect(neutralizeDescriptionRefs('see [#999](url) and \\#42', [], 'escape', repo)).toBe(
      'see [#999](url) and \\#42',
    );
  });

  it('should not leave a leading space when a duplicated ref opens the description', () => {
    expect(neutralizeDescriptionRefs('(#467) failed task', ['#467'], 'link', repo)).toBe('failed task');
  });

  it('should not leave a leading space when a stripped bare ref opens the description', () => {
    expect(neutralizeDescriptionRefs('#999 see here', [], 'strip', repo)).toBe('see here');
  });
});
