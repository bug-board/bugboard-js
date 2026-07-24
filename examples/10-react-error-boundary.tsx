/**
 * React error boundary (and Vue error handler).
 * ═════════════════════════════════════════════
 *
 * Demonstrates: catching render/lifecycle errors in a component tree and
 *               reporting them with the component stack attached.
 * Key type:     publishable (client-side).
 *
 * A React error boundary is a class component (there is no hook equivalent) that
 * catches errors thrown during rendering of its subtree. The useful part is
 * `info.componentStack` — pass it alongside the error. A nested Error still
 * contributes its full stack, so wrapping it in an object loses nothing.
 *
 * This file imports `react`; it type-checks only where React is installed.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import bugboard from './shared-client';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

export class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    bugboard.criticalHigh(
      // Stable title from the message; the varying detail goes in the body.
      `React error: ${error.message}`,
      { error, componentStack: info.componentStack },
      ['react'],
    );
  }

  render() {
    return this.state.hasError ? (this.props.fallback ?? <p>Something went wrong</p>) : this.props.children;
  }
}

// Wrap your tree:  <ErrorBoundary><App /></ErrorBoundary>

/*
 * Vue is simpler — a single global handler. Use `info` (Vue's lifecycle hook
 * name, a small fixed set) in the title rather than the error message, so cards
 * stay well-grouped:
 *
 *   const app = createApp(App);
 *   app.config.errorHandler = (err, instance, info) => {
 *     bugboard.critical(`Vue error: ${info}`, err, ['vue']);
 *   };
 *
 * Svelte has no component-level error hook — use window.onerror instead
 * (see 01-browser-publishable-key.ts).
 */
