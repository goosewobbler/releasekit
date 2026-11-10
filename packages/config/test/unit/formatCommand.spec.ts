import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../src/errors.js';
import { parseCommand, runFormatCommand } from '../../src/formatCommand.js';

describe('parseCommand', () => {
  it('should split on whitespace', () => {
    expect(parseCommand('  biome   format --write ')).toEqual(['biome', 'format', '--write']);
  });

  it('should keep quoted spaces in one argument and drop the quotes', () => {
    expect(parseCommand(`node "my tools/fmt.mjs" --config='a b' ""`)).toEqual([
      'node',
      'my tools/fmt.mjs',
      '--config=a b',
      '',
    ]);
  });

  it.each(['', '   ', 'prettier "--write'])('should reject %j as a ConfigError', (command) => {
    expect(() => parseCommand(command)).toThrow(ConfigError);
  });
});

describe('runFormatCommand', () => {
  it('should name the command when its binary is missing', async () => {
    await expect(runFormatCommand('releasekit-no-such-formatter --write', ['CHANGELOG.md'], tmpdir())).rejects.toThrow(
      /^git\.formatCommand `releasekit-no-such-formatter --write` could not run: .*ENOENT/,
    );
  });
});
