export { GitError, gitExitCode, isCommandNotFound, isExecTimeout } from './errors.js';
export {
  createFakeGit,
  type FakeCommitRecord,
  FakeGit,
  type FakeGitSeed,
  type FakeLog,
  type FakePushRecord,
  type FakeTagRecord,
} from './fake.js';
export { createGitCli, GitCli, type GitRunner } from './git.js';
export type {
  Git,
  GitCheckoutOptions,
  GitCommitOptions,
  GitCountCommitsOptions,
  GitFetchOptions,
  GitForEachRefOptions,
  GitListTagsOptions,
  GitLogOptions,
  GitPushOptions,
  GitStatusOptions,
  GitTagOptions,
} from './types.js';
