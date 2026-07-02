/**
 * BugBoard SDK for JavaScript and TypeScript.
 *
 * Report errors as cards on your BugBoard project board from Node 18+,
 * browsers, and edge runtimes — zero dependencies, built on the platform
 * `fetch`.
 *
 * @packageDocumentation
 */

export { createClient } from './client';
export {
    BugBoardError,
    BugBoardAuthError,
    BugBoardRateLimitError,
    BugBoardServerError,
    BugBoardValidationError,
} from './errors';
export type {
    BugBoardClient,
    BugBoardConfig,
    Priority,
    ReportFn,
    ReportMethodName,
    ReportPayload,
    Severity,
    TagsInput,
} from './types';
