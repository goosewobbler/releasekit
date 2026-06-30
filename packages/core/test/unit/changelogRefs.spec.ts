import { describe, expect, it } from 'vitest';
import { escapeChangelogMentions, parseGitHubOwnerRepo, renderIssueRefs } from '../../src/changelogRefs.js';

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

  it('should render a canonical /issues/ link in link mode', () => {
    expect(renderIssueRefs(['#481'], 'link', repo)).toBe('[#481](https://github.com/octocat/hello/issues/481)');
  });

  it('should join multiple refs with a comma in link mode', () => {
    expect(renderIssueRefs(['#1', '#2'], 'link', repo)).toBe(
      '[#1](https://github.com/octocat/hello/issues/1), [#2](https://github.com/octocat/hello/issues/2)',
    );
  });

  it('should normalise a bare numeric token without a leading #', () => {
    expect(renderIssueRefs(['481'], 'link', repo)).toBe('[#481](https://github.com/octocat/hello/issues/481)');
  });

  it('should fall back to escape when the repo URL is null in link mode', () => {
    expect(renderIssueRefs(['#481'], 'link', null)).toBe('\\#481');
  });

  it('should fall back to escape when the repo URL is non-GitHub in link mode', () => {
    expect(renderIssueRefs(['#481'], 'link', 'https://gitlab.com/o/r')).toBe('\\#481');
  });

  it('should render literal escaped refs in escape mode (no link even with a repo URL)', () => {
    expect(renderIssueRefs(['#481', '#7'], 'escape', repo)).toBe('\\#481, \\#7');
  });

  it('should return an empty string in strip mode', () => {
    expect(renderIssueRefs(['#481'], 'strip', repo)).toBe('');
  });

  it('should return an empty string when there are no refs', () => {
    expect(renderIssueRefs([], 'link', repo)).toBe('');
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
});
