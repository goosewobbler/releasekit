import type { StandingPrConfig } from '@releasekit/config';
import type { Forge, RepoPermission } from '@releasekit/forge';
import { readGitHubEvent } from '../github-event.js';

export type StandingPrAuthorization = NonNullable<StandingPrConfig['authorization']>;

const PERMISSION_RANK: Record<RepoPermission, number> = {
  admin: 5,
  maintain: 4,
  write: 3,
  triage: 2,
  read: 1,
  none: 0,
};

export interface EventActor {
  action?: string;
  login?: string;
  type?: string;
}

export function getEventActor(): EventActor {
  const event = readGitHubEvent<{
    action?: string;
    sender?: { login?: string; type?: string };
  }>();
  if (!event) {
    return {};
  }
  return {
    action: event.action,
    login: event.sender?.login,
    type: event.sender?.type,
  };
}

function isBot(login: string | undefined, type: string | undefined): boolean {
  return type === 'Bot' || login?.endsWith('[bot]') === true;
}

function parseTeamRef(entry: string): { org: string; team: string } | undefined {
  if (!entry.startsWith('@') || !entry.includes('/')) {
    return undefined;
  }
  const [org, team] = entry.slice(1).split('/');
  return org && team ? { org, team } : undefined;
}

/**
 * Bots are always authorized: the tool runs as one. Checks run cheapest-first: username, the permission lookup, then
 * one API call per allow-listed `@org/team`.
 */
export async function isAuthorizedActor(
  forge: Forge,
  login: string | undefined,
  type: string | undefined,
  authz: StandingPrAuthorization,
): Promise<boolean> {
  if (isBot(login, type)) {
    return true;
  }
  if (!login) {
    return false;
  }
  const entries = authz.allowedActors ?? [];

  // GitHub usernames are case-insensitive.
  const lc = login.toLowerCase();
  if (entries.some((e) => !parseTeamRef(e) && e.toLowerCase() === lc)) {
    return true;
  }

  const permission = await forge.getActorPermission(login);
  if (PERMISSION_RANK[permission] >= PERMISSION_RANK[authz.requiredPermission]) {
    return true;
  }

  // A 403 (no org-read scope) propagates to the caller's gate wrapper.
  for (const entry of entries) {
    const ref = parseTeamRef(entry);
    if (ref && (await forge.isTeamMember(ref.org, ref.team, login))) {
      return true;
    }
  }
  return false;
}
