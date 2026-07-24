// Recoverable errors within a route segment. This is a client component.
'use client';
import { useEffect, useRef } from 'react';
import bugboard from '@/lib/bugboard.client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Report each error exactly once. Two things would otherwise double-count it:
  // React Strict Mode double-invokes effects in development (setup → cleanup →
  // setup), and the effect re-runs on any re-render that changes `error`. The
  // ref persists across both, so a value we've already sent is skipped — while a
  // genuinely new error (different reference) still gets reported.
  const reported = useRef<unknown>(null);

  useEffect(() => {
    if (reported.current === error) return;
    reported.current = error;

    bugboard.critical(`Route error: ${error.message}`, error, ['nextjs', 'client']);
  }, [error]);

  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
