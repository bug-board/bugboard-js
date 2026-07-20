/**
 * BugBoard SDK for JavaScript and TypeScript.
 *
 * Report bugs as cards on your BugBoard project board from Node 20+,
 * browsers, and edge runtimes. Built on the platform `fetch`; the sole bundled
 * dependency is a sealed-box binding, lazy-loaded only when payload encryption
 * is enabled, so importing this module pulls in nothing.
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
