import { type CommentAuthor, type Forge, type ForgeComment, isBotComment } from '@releasekit/forge';

export interface TrustedCommentLookup {
  comment: ForgeComment | null;
  /** Why a marker comment that does exist isn't trusted. */
  refusal?: string;
}

function sameAccount(a: CommentAuthor | undefined, b: CommentAuthor | undefined): boolean {
  return a?.login !== undefined && a.login === b?.login && a.type === b?.type;
}

/**
 * A marker comment is trusted only when the bot that opened the issue or PR wrote it and made its latest edit, if any:
 * any other account, bot or not, can post one starting with the same marker, and anyone with write access can edit the
 * bot's.
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
  const name = (login: string | undefined) => (login ? `'${login}'` : 'an unknown account');
  const opener = (await forge.getIssue(issueNumber)).author;
  if (!isBotComment(comment) || opener?.login === undefined || comment.user?.login !== opener.login) {
    return {
      comment: null,
      refusal:
        `The ${what} on #${issueNumber} was posted by ${name(comment.user?.login)}, not by the bot account that ` +
        `opened #${issueNumber} (opened by ${name(opener?.login)}).`,
    };
  }
  // Body and editor come from one read, so an edit after `findComment` can't slip past this check.
  const authored = await forge.getAuthoredBody(comment.nodeId);
  const edited = authored.editor !== undefined || authored.lastEditedAt !== undefined;
  if (edited && !sameAccount(authored.editor, authored.author)) {
    return {
      comment: null,
      refusal:
        `The ${what} on #${issueNumber} was last edited by ${name(authored.editor?.login)}, not by the bot ` +
        'account that posted it.',
    };
  }
  return { comment: { ...comment, body: authored.body } };
}
