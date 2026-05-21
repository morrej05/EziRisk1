/**
 * RE document lock helper.
 *
 * A document is considered locked (read-only) once it has been issued or
 * superseded. Draft documents remain fully editable.
 *
 * All RE form components and BuildingsGrid use this single source of truth so
 * the lock rule can be changed in one place without touching individual forms.
 */
export type IssueStatus = 'draft' | 'issued' | 'superseded';

export function isReDocumentLocked(issueStatus: IssueStatus | string | null | undefined): boolean {
  return issueStatus === 'issued' || issueStatus === 'superseded';
}
