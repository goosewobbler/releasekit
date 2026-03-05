import { ReleaseKitError } from '@releasekit/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasePublishError, createPublishError, PublishError, PublishErrorCode } from '../../src/errors/index.js';

describe('PublishError', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('BasePublishError', () => {
    it('should extend ReleaseKitError', () => {
      const error = new BasePublishError('test message', 'TEST_CODE');
      expect(error).toBeInstanceOf(ReleaseKitError);
      expect(error).toBeInstanceOf(BasePublishError);
      expect(error.message).toBe('test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.suggestions).toEqual([]);
    });

    it('should accept suggestions', () => {
      const error = new BasePublishError('test', 'CODE', ['suggestion 1', 'suggestion 2']);
      expect(error.suggestions).toEqual(['suggestion 1', 'suggestion 2']);
    });

    it('should identify publish errors with type guard', () => {
      const publishError = new BasePublishError('test', 'CODE');
      const regularError = new Error('regular');

      expect(BasePublishError.isPublishError(publishError)).toBe(true);
      expect(BasePublishError.isPublishError(regularError)).toBe(false);
      expect(BasePublishError.isPublishError(null)).toBe(false);
      expect(BasePublishError.isPublishError(undefined)).toBe(false);
    });

    it('should log error with suggestions', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const error = new BasePublishError('test error', 'CODE', ['fix this', 'try that']);
      error.logError();

      // All output goes to stderr: error + header + 2 suggestions = 4 calls
      expect(errorSpy).toHaveBeenCalledTimes(4);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('test error');

      errorSpy.mockRestore();
    });

    it('should log error without suggestions when none provided', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const error = new BasePublishError('test error', 'CODE');
      error.logError();

      expect(errorSpy).toHaveBeenCalledTimes(1);

      errorSpy.mockRestore();
    });
  });

  describe('PublishError', () => {
    it('should extend BasePublishError', () => {
      const error = new PublishError('msg', 'CODE');
      expect(error).toBeInstanceOf(BasePublishError);
      expect(BasePublishError.isPublishError(error)).toBe(true);
    });
  });

  describe('createPublishError factory', () => {
    it('should create error for each error code', () => {
      for (const code of Object.values(PublishErrorCode)) {
        const error = createPublishError(code);
        expect(error).toBeInstanceOf(PublishError);
        expect(error.code).toBe(code);
        expect(error.message).toBeTruthy();
      }
    });

    it('should append details to message', () => {
      const error = createPublishError(PublishErrorCode.NPM_PUBLISH_ERROR, 'package @foo/bar');
      expect(error.message).toBe('Failed to publish to npm: package @foo/bar');
    });

    it('should provide suggestions for NPM_AUTH_ERROR', () => {
      const error = createPublishError(PublishErrorCode.NPM_AUTH_ERROR);
      expect(error.suggestions.length).toBeGreaterThan(0);
      expect(error.suggestions.some((s) => s.includes('NPM_TOKEN'))).toBe(true);
    });

    it('should provide suggestions for CARGO_AUTH_ERROR', () => {
      const error = createPublishError(PublishErrorCode.CARGO_AUTH_ERROR);
      expect(error.suggestions.length).toBeGreaterThan(0);
      expect(error.suggestions.some((s) => s.includes('CARGO_REGISTRY_TOKEN'))).toBe(true);
    });

    it('should provide suggestions for GIT_PUSH_ERROR', () => {
      const error = createPublishError(PublishErrorCode.GIT_PUSH_ERROR);
      expect(error.suggestions.some((s) => s.includes('SSH') || s.includes('deploy key'))).toBe(true);
    });

    it('should provide suggestions for GITHUB_RELEASE_ERROR', () => {
      const error = createPublishError(PublishErrorCode.GITHUB_RELEASE_ERROR);
      expect(error.suggestions.some((s) => s.includes('gh'))).toBe(true);
    });
  });
});
