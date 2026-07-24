// Server-side client — SECRET key (HMAC).
//
// `import 'server-only'` turns a leaked secret key into a BUILD failure if this
// module is ever imported from a client component. Install it: `npm i server-only`.
import 'server-only';
import { createClient } from 'bugboard';

export default createClient({
  keyId: process.env.BUGBOARD_KEY_ID, // bbk_…
  signingSecret: process.env.BUGBOARD_SIGNING_SECRET, // bb_sec_… (never transmitted)
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
});
