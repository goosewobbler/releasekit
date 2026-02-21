import { BaseVersionError } from './baseError.js';

/**
 * Custom error class for Git operations
 */
export class GitError extends BaseVersionError {}

/**
 * Error codes for Git operations
 */
export enum GitErrorCode {
  NOT_GIT_REPO = 'NOT_GIT_REPO',
  GIT_PROCESS_ERROR = 'GIT_PROCESS_ERROR',
  NO_FILES = 'NO_FILES',
  NO_COMMIT_MESSAGE = 'NO_COMMIT_MESSAGE',
  GIT_ERROR = 'GIT_ERROR',
  TAG_ALREADY_EXISTS = 'TAG_ALREADY_EXISTS',
}

/**
 * Creates a GitError with standard error message for common failure scenarios
 * @param code Error code
 * @param details Additional error details
 * @returns GitError instance
 */
export function createGitError(code: GitErrorCode, details?: string): GitError {
  const messages: Record<GitErrorCode, string> = {
    [GitErrorCode.NOT_GIT_REPO]: 'Not a git repository',
    [GitErrorCode.GIT_PROCESS_ERROR]: 'Failed to create new version',
    [GitErrorCode.NO_FILES]: 'No files specified for commit',
    [GitErrorCode.NO_COMMIT_MESSAGE]: 'Commit message is required',
    [GitErrorCode.GIT_ERROR]: 'Git operation failed',
    [GitErrorCode.TAG_ALREADY_EXISTS]: 'Git tag already exists',
  };

  // Provide helpful suggestions for specific error types
  const suggestions: Record<GitErrorCode, string[] | undefined> = {
    [GitErrorCode.NOT_GIT_REPO]: [
      'Initialize git repository with: git init',
      'Ensure you are in the correct directory',
    ],
    [GitErrorCode.TAG_ALREADY_EXISTS]: [
      'Delete the existing tag: git tag -d <tag-name>',
      'Use a different version by incrementing manually',
      'Check if this version was already released',
    ],
    [GitErrorCode.GIT_PROCESS_ERROR]: undefined,
    [GitErrorCode.NO_FILES]: undefined,
    [GitErrorCode.NO_COMMIT_MESSAGE]: undefined,
    [GitErrorCode.GIT_ERROR]: undefined,
  };

  const baseMessage = messages[code];
  const fullMessage = details ? `${baseMessage}: ${details}` : baseMessage;

  return new GitError(fullMessage, code, suggestions[code]);
}
