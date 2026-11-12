import type { JSX as ReactJSX } from 'react';

// The existing docs homepage uses the legacy global JSX.Element return type.
// Keep that annotation compatible with React 19's module-scoped JSX types.
declare global {
  namespace JSX {
    interface Element extends ReactJSX.Element {}
  }
}
