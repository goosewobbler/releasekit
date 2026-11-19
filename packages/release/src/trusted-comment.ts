import { type Forge, type ForgeComment, isBotComment } from '@releasekit/forge';

export interface TrustedCommentLookup {
  comment: ForgeComment | null;
  /** Why a marker comment that does exist isn't trusted. */
  refusal?: string;
}

/**
 * A marker comment is trusted only when the bot that opened the issue or PR wrote it: any other account, bot or not,
 * can post one starting with the same marker.
 */
export async function findTrustedComment(
  forge: Forge,
  issueNumber: number,
  marker: string,
  what: string,
): Promise<TrustedCommentLookup> {
  const comment = await forge.findComment(issueNumber, marker);
  if (!comment) {
    return { comment: null };
  }
  const opener = (await forge.getIssue(issueNumber)).author;
  if (isBotComment(comment) && opener?.login !== undefined && comment.user?.login === opener.login) {
    return { comment };
  }
  const name = (login: string | undefined) => (login ? `'${login}'` : 'an unknown account');
  return {
    comment: null,
    refusal:
      `The ${what} on #${issueNumber} was posted by ${name(comment.user?.login)}, not by the bot account that ` +
      `opened #${issueNumber} (opened by ${name(opener?.login)}).`,
  };
}
