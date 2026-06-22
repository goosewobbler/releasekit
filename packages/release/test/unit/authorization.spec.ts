import * as fs from 'node:fs';
import { createFakeForge } from '@releasekit/forge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEventActor, isAuthorizedActor, type StandingPrAuthorization } from '../../src/standing-pr/authorization.js';

const authz = (overrides: Partial<StandingPrAuthorization> = {}): StandingPrAuthorization => ({
  requiredPermission: 'admin',
  ...overrides,
});

describe('isAuthorizedActor', () => {
  it('should always authorize a bot actor (the tool runs as one)', async () => {
    const forge = createFakeForge();
    expect(await isAuthorizedActor(forge, 'github-actions[bot]', 'Bot', authz())).toBe(true);
    // Type-based detection too (login not suffixed).
    expect(await isAuthorizedActor(forge, 'my-app', 'Bot', authz())).toBe(true);
  });

  it('should authorize an actor whose permission meets the threshold', async () => {
    const forge = createFakeForge({ actorPermissions: { alice: 'admin', bob: 'write' } });
    expect(await isAuthorizedActor(forge, 'alice', 'User', authz({ requiredPermission: 'admin' }))).toBe(true);
    expect(await isAuthorizedActor(forge, 'bob', 'User', authz({ requiredPermission: 'write' }))).toBe(true);
  });

  it('should reject an actor below the threshold', async () => {
    const forge = createFakeForge({ actorPermissions: { bob: 'write', carol: 'triage' } });
    expect(await isAuthorizedActor(forge, 'bob', 'User', authz({ requiredPermission: 'admin' }))).toBe(false);
    expect(await isAuthorizedActor(forge, 'carol', 'User', authz({ requiredPermission: 'write' }))).toBe(false);
  });

  it('should authorize an explicitly allow-listed actor regardless of permission', async () => {
    const forge = createFakeForge({ actorPermissions: { dave: 'read' } });
    expect(await isAuthorizedActor(forge, 'dave', 'User', authz({ allowedActors: ['dave'] }))).toBe(true);
  });

  it('should reject an unknown actor (no login, or no repo access)', async () => {
    const forge = createFakeForge();
    expect(await isAuthorizedActor(forge, undefined, 'User', authz())).toBe(false);
    expect(await isAuthorizedActor(forge, 'stranger', 'User', authz())).toBe(false); // unseeded → 'none'
  });
});

describe('getEventActor', () => {
  const ORIG = process.env.GITHUB_EVENT_PATH;
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = `${process.env.TMPDIR ?? '/tmp'}/rk-event-${process.pid}.json`;
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.GITHUB_EVENT_PATH;
    else process.env.GITHUB_EVENT_PATH = ORIG;
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  });

  it('should read action, sender, and merged_by from the event payload', () => {
    fs.writeFileSync(
      tmpFile,
      JSON.stringify({
        action: 'edited',
        sender: { login: 'alice', type: 'User' },
        pull_request: { merged_by: { login: 'maintainer' } },
      }),
    );
    process.env.GITHUB_EVENT_PATH = tmpFile;

    expect(getEventActor()).toEqual({
      action: 'edited',
      login: 'alice',
      type: 'User',
      mergedBy: 'maintainer',
    });
  });

  it('should return an empty actor when no event path is set', () => {
    delete process.env.GITHUB_EVENT_PATH;
    expect(getEventActor()).toEqual({});
  });
});
