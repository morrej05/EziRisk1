/**
 * Shared document locking helper used by RE, FSD, DSEAR, actions, evidence, and report editing.
 *
 * A document is locked when its issue_status is 'issued' or 'superseded'.
 * Locked documents must not accept writes from any form, recommendation modal, or evidence uploader.
 */

export type IssueStatus = 'draft' | 'issued' | 'superseded';

/**
 * Returns true if the document is locked (issued or superseded) and must be treated as read-only.
 */
export function isDocumentLocked(
  issueStatus: IssueStatus | string | null | undefined
): boolean {
  return issueStatus === 'issued' || issueStatus === 'superseded';
}
