// Root layout errors. Unlike error.tsx, this replaces the root layout, so it
// must render its own <html> and <body>.
'use client';
import { useEffect, useRef } from 'react';
import bugboard from '@/lib/bugboard.client';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  // Report each error exactly once — see the note in error.tsx. Strict Mode's
  // double-invoked effects and re-renders that change `error` would otherwise
  // send the same report more than once; the ref guards against both.
  const reported = useRef<unknown>(null);

  useEffect(() => {
    if (reported.current === error) return;
    reported.current = error;

    bugboard.criticalHigh(`Root error: ${error.message}`, error, ['nextjs', 'fatal']);
  }, [error]);

  return (
    <html>
      <body>
        <h2>Something went wrong</h2>
      </body>
    </html>
  );
}
