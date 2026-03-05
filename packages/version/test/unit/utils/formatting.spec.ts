import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCommitMessage, formatTag, formatTagPrefix, formatVersionPrefix } from '../../../src/utils/formatting.js';

vi.mock('../../../src/utils/logging.js', () => ({
  log: vi.fn(),
}));

import { log } from '../../../src/utils/logging.js';

describe('formatting', () => {
  let logSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    logSpy = vi.mocked(log);
    logSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('formatTag', () => {
    it('should format tag with version and prefix', () => {
      const result = formatTag('1.0.0', 'v');
      expect(result).toBe('v1.0.0');
    });

    it('should format tag with custom template', () => {
      const result = formatTag('1.0.0', 'v', 'my-package', '${' + 'packageName}@${' + 'prefix}${' + 'version}', true);
      expect(result).toBe('my-package@v1.0.0');
    });

    it('should format tag with version template only', () => {
      const result = formatTag('1.0.0', 'v', undefined, 'version-${' + 'version}', false);
      expect(result).toBe('version-1.0.0');
    });

    it('should format tag with package name template and packageSpecificTags enabled', () => {
      const result = formatTag('1.0.0', 'v', 'my-package', '${' + 'packageName}-${' + 'version}', true);
      expect(result).toBe('my-package-1.0.0');
    });

    it('should format tag with custom template using prefix', () => {
      const result = formatTag('1.0.0', 'v', undefined, '[${' + 'prefix}] ${' + 'version}', false);
      expect(result).toBe('[v] 1.0.0');
    });

    it('should handle empty prefix', () => {
      const result = formatTag('1.0.0', '');
      expect(result).toBe('1.0.0');
    });

    it('should warn when using ${packageName} without package name', () => {
      const result = formatTag('1.0.0', 'v', null, '${' + 'packageName}@${' + 'prefix}${' + 'version}', false);
      expect(result).toBe('@v1.0.0');
      expect(logSpy).toHaveBeenCalledWith(
        'Warning: Your tagTemplate contains ${' +
          'packageName} but no package name is available.\n' +
          'This will result in an empty package name in the tag (e.g., "@v1.0.0" instead of "my-package@v1.0.0").\n\n' +
          'To fix this:\n' +
          '• If using sync mode: Set "packageSpecificTags": true in your config to enable package names in tags\n' +
          '• If you want global tags: Remove ${' +
          'packageName} from your tagTemplate (e.g., use "${' +
          'prefix}${' +
          'version}")\n' +
          '• If using single/async mode: Ensure your package.json has a valid "name" field',
        'warning',
      );
    });

    it('should not warn when using ${packageName} with packageSpecificTags enabled', () => {
      const result = formatTag('1.0.0', 'v', 'my-package', '${' + 'packageName}@${' + 'prefix}${' + 'version}', true);
      expect(result).toBe('my-package@v1.0.0');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should not warn when not using ${packageName} regardless of packageSpecificTags', () => {
      const result = formatTag('1.0.0', 'v', 'my-package', '${' + 'prefix}${' + 'version}', false);
      expect(result).toBe('v1.0.0');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should use default package-specific format when packageSpecificTags is true', () => {
      const result = formatTag('1.0.0', 'v', 'my-package', undefined, true);
      expect(result).toBe('my-package@v1.0.0');
    });
  });

  describe('formatVersionPrefix', () => {
    it('should return prefix as-is when no trailing slash', () => {
      const result = formatVersionPrefix('v');
      expect(result).toBe('v');
    });

    it('should remove trailing slash from prefix', () => {
      const result = formatVersionPrefix('v/');
      expect(result).toBe('v');
    });

    it('should handle empty prefix', () => {
      const result = formatVersionPrefix('');
      expect(result).toBe('');
    });
  });

  describe('formatTagPrefix', () => {
    it('should return prefix for simple case', () => {
      const result = formatTagPrefix('v');
      expect(result).toBe('v');
    });

    it('should return package-specific prefix when packageSpecificTags is true', () => {
      const result = formatTagPrefix('v', 'my-package', undefined, true);
      expect(result).toBe('my-package@v');
    });

    it('should handle template-based prefix', () => {
      const result = formatTagPrefix('v', 'my-package', '${' + 'packageName}@${' + 'prefix}${' + 'version}');
      expect(result).toBe('my-package@v*');
    });

    it('should handle template without package name', () => {
      const result = formatTagPrefix('v', undefined, '${' + 'prefix}${' + 'version}');
      expect(result).toBe('v*');
    });
  });

  describe('formatCommitMessage', () => {
    it('should replace version placeholder in template', () => {
      const result = formatCommitMessage('Release version ${' + 'version}', '1.0.0');
      expect(result).toBe('Release version 1.0.0');
    });

    it('should replace both version and additional context placeholders', () => {
      const result = formatCommitMessage('Release ${' + 'scope} version ${' + 'version}', '1.0.0', undefined, {
        scope: 'app',
      });
      expect(result).toBe('Release app version 1.0.0');
    });

    it('should handle missing additional context', () => {
      const result = formatCommitMessage('Release ${' + 'scope} version ${' + 'version}', '1.0.0');
      expect(result).toBe('Release ${' + 'scope} version 1.0.0');
    });

    it('should replace packageName placeholder in template', () => {
      const result = formatCommitMessage('Release ${' + 'packageName}@${' + 'version}', '1.0.0', 'my-package');
      expect(result).toBe('Release my-package@1.0.0');
    });

    it('should replace all placeholders together', () => {
      const result = formatCommitMessage(
        'Release ${' + 'packageName}@${' + 'version} in ${' + 'scope} scope',
        '1.0.0',
        'my-package',
        { scope: 'app' },
      );
      expect(result).toBe('Release my-package@1.0.0 in app scope');
    });

    it('should warn when using ${packageName} without providing packageName', () => {
      const result = formatCommitMessage('Release ${' + 'packageName}@${' + 'version}', '1.0.0');
      expect(result).toBe('Release @1.0.0');
      expect(logSpy).toHaveBeenCalledWith(
        'Warning: Your commitMessage template contains ${' +
          'packageName} but no package name is available.\n' +
          'This will result in an empty package name in the commit message (e.g., "Release @v1.0.0").\n\n' +
          'To fix this:\n' +
          '• If using sync mode: Set "packageSpecificTags": true to enable package names in commits\n' +
          '• If you want generic commit messages: Remove ${' +
          'packageName} from your commitMessage template\n' +
          '• If using single/async mode: Ensure your package.json has a valid "name" field',
        'warning',
      );
    });

    it('should not warn when using ${packageName} with packageName provided', () => {
      const result = formatCommitMessage('Release ${' + 'packageName}@${' + 'version}', '1.0.0', 'my-package');
      expect(result).toBe('Release my-package@1.0.0');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should not warn when not using ${packageName} in template', () => {
      const result = formatCommitMessage('Release version ${' + 'version}', '1.0.0');
      expect(result).toBe('Release version 1.0.0');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should handle additional context keys with special regex characters', () => {
      const result = formatCommitMessage(
        '${' + 'test.key} ${' + 'test*key} ${' + 'test+key} ${' + 'test?key}',
        '1.0.0',
        undefined,
        {
          'test.key': 'dot',
          'test*key': 'star',
          'test+key': 'plus',
          'test?key': 'question',
        },
      );
      expect(result).toBe('dot star plus question');
    });

    it('should handle additional context keys with regex metacharacters', () => {
      const result = formatCommitMessage('${' + 'a$b} ${' + 'c^d} ${' + 'e|f} ${' + 'g[h]}', '1.0.0', undefined, {
        a$b: 'dollar',
        'c^d': 'caret',
        'e|f': 'pipe',
        'g[h]': 'bracket',
      });
      expect(result).toBe('dollar caret pipe bracket');
    });
  });

  describe('formatTag with context-aware warnings', () => {
    it('should show warning when template uses packageName but none provided', () => {
      formatTag('1.0.0', 'v', null, '${' + 'packageName}@${' + 'prefix}${' + 'version}', false);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Your tagTemplate contains ${' + 'packageName}'),
        'warning',
      );
    });

    it('should not show warning when template uses packageName and one is provided', () => {
      formatTag('1.0.0', 'v', 'my-package', '${' + 'packageName}@${' + 'prefix}${' + 'version}', false);

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('formatCommitMessage with context-aware warnings', () => {
    it('should show warning when template uses packageName but none provided', () => {
      formatCommitMessage('chore: release ${' + 'packageName}@${' + 'version}', '1.0.0');

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Warning: Your commitMessage template contains ${' + 'packageName}'),
        'warning',
      );
    });

    it('should not show warning when template uses packageName and one is provided', () => {
      formatCommitMessage('chore: release ${' + 'packageName}@${' + 'version}', '1.0.0', 'my-package');

      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});
