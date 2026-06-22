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
}

/** Read the triggering actor (and the merger, for publish) from the GitHub Actions event payload. */
export function getEventActor(): EventActor {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return {};
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8')) as {
      action?: string;
      sender?: { login?: string; type?: string };
      pull_request?: { merged_by?: { login?: string } | null };
    };
    return {
      action: event.action,
      login: event.sender?.login,
      type: event.sender?.type,
      mergedBy: event.pull_request?.merged_by?.login,
    };
  } catch {
    return {};
  }
}

/** A bot actor (the tool itself / a GitHub App) — always authorized; its own runs drive the PR. */
function isBot(login: string | undefined, type: string | undefined): boolean {
  return type === 'Bot' || (login !== undefined && login.endsWith('[bot]'));
}

/**
 * Whether `login` may steer the standing PR under `authz`. Bots are always authorized (the tool runs
 * as one). Otherwise the actor passes if explicitly allow-listed, or if their repository permission
 * meets the configured threshold. An unknown actor (no login, or no repo access) is not authorized.
 */
export async function isAuthorizedActor(
  forge: Forge,
  login: string | undefined,
  type: string | undefined,
  authz: StandingPrAuthorization,
): Promise<boolean> {
  if (isBot(login, type)) return true;
  if (!login) return false;
  // GitHub usernames are case-insensitive, so compare case-folded — a `allowedActors: ['Alice']`
  // entry must still match an event delivering `login: 'alice'`.
  const lc = login.toLowerCase();
  if (authz.allowedActors?.some((a) => a.toLowerCase() === lc)) return true;
  const permission = await forge.getActorPermission(login);
  return PERMISSION_RANK[permission] >= PERMISSION_RANK[authz.requiredPermission];
}
