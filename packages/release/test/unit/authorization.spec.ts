import { createFakeForge } from '@releasekit/forge';
import { describe, expect, it, vi } from 'vitest';
import { isAuthorizedActor, type StandingPrAuthorization } from '../../src/standing-pr/authorization.js';

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

  it('should match the allow-list case-insensitively (GitHub usernames are case-insensitive)', async () => {
    const forge = createFakeForge({ actorPermissions: { Alice: 'read' } });
    expect(await isAuthorizedActor(forge, 'alice', 'User', authz({ allowedActors: ['Alice'] }))).toBe(true);
  });

  it('should reject an unknown actor (no login, or no repo access)', async () => {
    const forge = createFakeForge();
    expect(await isAuthorizedActor(forge, undefined, 'User', authz())).toBe(false);
    expect(await isAuthorizedActor(forge, 'stranger', 'User', authz())).toBe(false);
  });

  it('should authorize a member of an allow-listed @org/team', async () => {
    const forge = createFakeForge({ teamMemberships: { 'acme/releasers': ['carol'] } });
    expect(await isAuthorizedActor(forge, 'carol', 'User', authz({ allowedActors: ['@acme/releasers'] }))).toBe(true);
    // A non-member with no threshold permission is rejected.
    expect(await isAuthorizedActor(forge, 'dave', 'User', authz({ allowedActors: ['@acme/releasers'] }))).toBe(false);
  });

  it('should check team membership only after username + threshold (no team call for an admin)', async () => {
    const forge = createFakeForge({ actorPermissions: { alice: 'admin' } });
    const teamSpy = vi.spyOn(forge, 'isTeamMember');
    expect(await isAuthorizedActor(forge, 'alice', 'User', authz({ allowedActors: ['@acme/releasers'] }))).toBe(true);
    expect(teamSpy).not.toHaveBeenCalled();
  });
});
