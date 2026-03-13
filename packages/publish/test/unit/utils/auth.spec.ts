import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectNpmAuth, hasCargoAuth } from '../../../src/utils/auth.js';

describe('auth utils', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete process.env.NPM_TOKEN;
    delete process.env.NODE_AUTH_TOKEN;
    delete process.env.CARGO_REGISTRY_TOKEN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('detectNpmAuth', () => {
    it('should return null when no auth env vars are set', () => {
      expect(detectNpmAuth()).toBeNull();
    });

    it('should return "oidc" when ACTIONS_ID_TOKEN_REQUEST_URL is set', () => {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.actions.githubusercontent.com';
      expect(detectNpmAuth()).toBe('oidc');
    });

    it('should return "token" when NPM_TOKEN is set', () => {
      process.env.NPM_TOKEN = 'npm_abc123';
      expect(detectNpmAuth()).toBe('token');
    });

    it('should return "token" when NODE_AUTH_TOKEN is set', () => {
      process.env.NODE_AUTH_TOKEN = 'npm_abc123';
      expect(detectNpmAuth()).toBe('token');
    });

    it('should prefer OIDC over token', () => {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = 'https://token.actions.githubusercontent.com';
      process.env.NPM_TOKEN = 'npm_abc123';
      expect(detectNpmAuth()).toBe('oidc');
    });
  });

  describe('hasCargoAuth', () => {
    it('should return false when CARGO_REGISTRY_TOKEN is not set', () => {
      expect(hasCargoAuth()).toBe(false);
    });

    it('should return true when CARGO_REGISTRY_TOKEN is set', () => {
      process.env.CARGO_REGISTRY_TOKEN = 'crt_abc123';
      expect(hasCargoAuth()).toBe(true);
    });
  });
});
