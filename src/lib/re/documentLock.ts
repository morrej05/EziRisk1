/**
 * RE document lock helper — thin re-export of the shared utility.
 *
 * All RE form components and BuildingsGrid import from here so the symbol name
 * (isReDocumentLocked) stays stable.  The underlying logic lives in
 * src/utils/documentLock.ts which is also used by FSD and DSEAR forms.
 */
export type { IssueStatus } from '../../utils/documentLock';
export { isDocumentLocked as isReDocumentLocked } from '../../utils/documentLock';
