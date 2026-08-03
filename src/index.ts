/**
 * BugBoard SDK for JavaScript and TypeScript.
 *
 * Report bugs as cards on your BugBoard project board from Node 20+,
 * browsers, and edge runtimes. Built on the platform `fetch`; the sole
 * dependency is a sealed-box binding, dynamically imported only when payload
 * encryption is enabled, so importing this module loads nothing else.
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
export { enableNodeSourceMaps as enableSourceMaps } from './sourcemaps-node';
export type { SourceMapStatus } from './sourcemaps-node';
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
