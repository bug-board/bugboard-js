// Browser client — PUBLISHABLE key (bb_pub_…), safe in the bundle.
//
// The `NEXT_PUBLIC_` prefix is what makes the value reach the browser. NEVER put
// keyId/signingSecret here — anything with that prefix ends up in the bundle.
'use client';
import { createClient } from 'bugboard';

export default createClient({
  apiKey: process.env.NEXT_PUBLIC_BUGBOARD_API_KEY, // bb_pub_…
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV,
});
