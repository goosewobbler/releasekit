import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { findCargoLockfile } from '@releasekit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncCargoLockfile } from '../../../src/cargo/cargoLock.js';
import { log } from '../../../src/utils/logging.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('@releasekit/core', () => ({ findCargoLockfile: vi.fn() }));
vi.mock('../../../src/utils/logging.js', () => ({ log: vi.fn() }));

const crateDir = path.join('/repo', 'crates', 'foo');
const cargoToml = path.join(crateDir, 'Cargo.toml');
const lockPath = path.join('/repo', 'Cargo.lock');

describe('syncCargoLockfile', () => {
  afterEach(() => vi.clearAllMocks());

  it('should run an offline workspace-scoped cargo update and return the lock path', () => {
    vi.mocked(findCargoLockfile).mockReturnValue(lockPath);

    const result = syncCargoLockfile(cargoToml);

    expect(result).toBe(lockPath);
    expect(execFileSync).toHaveBeenCalledWith('cargo', ['update', '--workspace', '--offline'], {
      cwd: crateDir,
      stdio: 'pipe',
    });
  });

  it('should skip the refresh and not run cargo under dry-run', () => {
    vi.mocked(findCargoLockfile).mockReturnValue(lockPath);

    const result = syncCargoLockfile(cargoToml, true);

    expect(result).toBeUndefined();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('should do nothing when there is no committed lock above the crate', () => {
    vi.mocked(findCargoLockfile).mockReturnValue(undefined);

    const result = syncCargoLockfile(cargoToml);

    expect(result).toBeUndefined();
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('should warn and return undefined when cargo is not on PATH', () => {
    vi.mocked(findCargoLockfile).mockReturnValue(lockPath);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('spawn cargo ENOENT'), { code: 'ENOENT' });
    });

    const result = syncCargoLockfile(cargoToml);

    expect(result).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cargo not found on PATH'), 'warning');
  });

  it('should warn with the cargo error and return undefined when the refresh fails', () => {
    vi.mocked(findCargoLockfile).mockReturnValue(lockPath);
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('exit 101'), { stderr: Buffer.from('error: version conflict') });
    });

    const result = syncCargoLockfile(cargoToml);

    expect(result).toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('error: version conflict'), 'warning');
  });
});
