import * as fs from 'node:fs';
import type { StandingPrConfig } from '@releasekit/config';
import type { Forge, RepoPermission } from '@releasekit/forge';

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
  mergedBy?: string;
  mergedByType?: string;
}

export function getEventActor(): EventActor {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return {};
  }
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8')) as {
      action?: string;
      sender?: { login?: string; type?: string };
      pull_request?: { merged_by?: { login?: string; type?: string } | null };
    };
    return {
      action: event.action,
      login: event.sender?.login,
      type: event.sender?.type,
      mergedBy: event.pull_request?.merged_by?.login,
      mergedByType: event.pull_request?.merged_by?.type,
    };
  } catch {
    return {};
  }
}

function isBot(login: string | undefined, type: string | undefined): boolean {
  return type === 'Bot' || (login !== undefined && login.endsWith('[bot]'));
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
