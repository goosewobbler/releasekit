import * as fs from 'node:fs';
import type { StandingPrConfig } from '@releasekit/config';
import type { Forge, RepoPermission } from '@releasekit/forge';

/**
 * Authorization for the standing PR — decides who may steer it (tick/untick selection, apply release
 * labels, and, at publish time, who merged it). The enforcement itself lives in the standing-pr flow;
 * this module is the shared primitive: read the acting GitHub user from the event, and test whether a
 * user is authorized under the configured policy. No-op until `ci.standingPr.authorization` is set.
 */

export type StandingPrAuthorization = NonNullable<StandingPrConfig['authorization']>;

/** Repo-permission ranks, highest→lowest, for threshold comparison. */
const PERMISSION_RANK: Record<RepoPermission, number> = {
  admin: 5,
  maintain: 4,
  write: 3,
  triage: 2,
  read: 1,
  none: 0,
};

export interface EventActor {
  /** The `pull_request` event action (labeled / unlabeled / edited / closed / …), if any. */
  action?: string;
  /** The actor who triggered the event (`event.sender.login`). */
  login?: string;
  /** The actor's GitHub type (`event.sender.type`) — `'Bot'` for app/bot actors. */
  type?: string;
  /** Who merged the PR (`event.pull_request.merged_by.login`), for the publish-author gate. */
  mergedBy?: string;
  /** The merger's GitHub type (`event.pull_request.merged_by.type`) — `'Bot'` for app/bot actors. */
  mergedByType?: string;
}

/** Read the triggering actor (and the merger, for publish) from the GitHub Actions event payload. */
export function getEventActor(): EventActor {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};
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

/** A bot actor (the tool itself / a GitHub App) — always authorized; its own runs drive the PR. */
function isBot(login: string | undefined, type: string | undefined): boolean {
  return type === 'Bot' || (login !== undefined && login.endsWith('[bot]'));
}

/** An `allowedActors` entry naming a GitHub team, e.g. `@acme/releasers` → `{ org, team }`. */
function parseTeamRef(entry: string): { org: string; team: string } | undefined {
  if (!entry.startsWith('@') || !entry.includes('/')) return undefined;
  const [org, team] = entry.slice(1).split('/');
  return org && team ? { org, team } : undefined;
}

/**
 * Whether `login` may steer the standing PR under `authz`. Bots are always authorized (the tool runs
 * as one). Otherwise the actor passes if explicitly allow-listed by username, if their repository
 * permission meets the configured threshold, or if they're a member of an allow-listed `@org/team`.
 * An unknown actor (no login, or no repo access / team membership) is not authorized.
 *
 * Checks are ordered cheapest-first — username, then the single permission API call, then team
 * membership (one API call per `@org/team`, only reached for an actor not already authorized).
 */
export async function isAuthorizedActor(
  forge: Forge,
  login: string | undefined,
  type: string | undefined,
  authz: StandingPrAuthorization,
): Promise<boolean> {
  if (isBot(login, type)) return true;
  if (!login) return false;
  const entries = authz.allowedActors ?? [];

  // 1. Username allow-list. GitHub usernames are case-insensitive, so compare case-folded — an
  //    `allowedActors: ['Alice']` entry must still match an event delivering `login: 'alice'`.
  const lc = login.toLowerCase();
  if (entries.some((e) => !parseTeamRef(e) && e.toLowerCase() === lc)) return true;

  // 2. Repository permission threshold.
  const permission = await forge.getActorPermission(login);
  if (PERMISSION_RANK[permission] >= PERMISSION_RANK[authz.requiredPermission]) return true;

  // 3. Team membership — last, since it costs an API call per team and a 403 (no org-read scope)
  //    propagates to the caller's gate wrapper. An `@org/team` member is authorized regardless of
  //    repo permission.
  for (const entry of entries) {
    const ref = parseTeamRef(entry);
    if (ref && (await forge.isTeamMember(ref.org, ref.team, login))) return true;
  }
  return false;
}
