import { describe, expect, it } from 'vitest';
import { graduationOvershoot } from '../../src/standing-pr/graduation.js';

const breaking = { type: 'changed', description: 'drop the old API', breaking: true };
const feature = { type: 'added', description: 'add a flag' };
const fix = { type: 'fixed', description: 'fix a crash' };

describe('graduationOvershoot', () => {
  it('should flag a breaking change queued on a minor line', () => {
    expect(graduationOvershoot([fix, breaking], '1.1.0-next.3')).toBe('major');
  });

  it('should flag a feature queued on a patch line', () => {
    expect(graduationOvershoot([feature], '1.0.1-next.0')).toBe('minor');
  });

  it('should accept changes the line already covers', () => {
    expect(graduationOvershoot([feature, fix], '1.1.0-next.3')).toBeUndefined();
    expect(graduationOvershoot([breaking], '2.0.0-next.1')).toBeUndefined();
  });

  it('should treat a pre-1.0 breaking change as a minor under zeroMajor spec, but not strict', () => {
    expect(graduationOvershoot([breaking], '0.4.0-next.1')).toBeUndefined();
    expect(graduationOvershoot([breaking], '0.4.0-next.1', 'strict')).toBe('major');
  });

  it('should ignore a synthetic lockstep carry', () => {
    expect(graduationOvershoot([{ ...breaking, synthetic: true }], '1.1.0-next.3')).toBeUndefined();
  });
});
