// instrumentation.ts (Next.js 15+) — lives at the project root, next to next.config.
//
// Catches server errors Next.js handles internally, BEFORE they're redacted to a
// generic message + digest in production. This is usually the *useful* report,
// since error.tsx on the client only sees the redacted version.
import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const bugboard = (await import('@/lib/bugboard.server')).default;

  // Use context.routePath (the pattern, e.g. /users/[id]) over request.path (the
  // URL) so reports dedupe instead of creating a card per id.
  bugboard.criticalHigh(`Server error: ${context.routePath ?? request.path}`, err, [
    'nextjs',
    'server',
    context.routerKind,
  ]);

  await bugboard.flush();
};
