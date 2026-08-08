// Application entry point.

import { render } from 'preact';
import { App } from './app';

render(<App />, document.getElementById('app')!);

// Register service worker for PWA installability
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Service worker registration is non-critical
  });
}
