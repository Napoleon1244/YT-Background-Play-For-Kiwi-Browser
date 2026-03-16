/**
 * YT Background Play — INJECTOR (Isolated World)
 *
 * This content script runs in Chrome's "isolated world".
 * Its ONLY job is to inject main-world.js as a real <script> tag
 * so that script executes in the PAGE's JavaScript context (main world).
 *
 * This is the canonical technique used by Mozilla's video-bg-play extension
 * and is required because Object.defineProperty in isolated world
 * does NOT affect the page's own JS execution context.
 */

(function () {
  'use strict';

  function injectMainWorldScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('main-world.js');
      script.type = 'text/javascript';

      // Inject as early as possible — before any YouTube scripts run
      const target = document.head || document.documentElement;
      target.insertBefore(script, target.firstChild);

      // Clean up the tag after it loads (optional but tidy)
      script.addEventListener('load', () => {
        script.remove();
      });
    } catch (e) {
      console.error('[YT Background Play] Injector failed:', e);
    }
  }

  // document_start fires before DOM is ready — inject immediately
  if (document.readyState === 'loading') {
    injectMainWorldScript();
  } else {
    // Fallback: already past document_start (e.g., dynamic navigation)
    injectMainWorldScript();
  }

  // YouTube is a SPA — handle navigation (e.g. clicking a new video)
  // The script persists in memory but re-guard on navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // main-world.js checks window.__ytbgplay_injected so it won't re-run
      // but video elements change — re-trigger from main world via event
      document.dispatchEvent(new CustomEvent('__ytbg_navigate'));
    }
  }).observe(document, { subtree: true, childList: true });

  console.log('[YT Background Play] Injector loaded on', location.hostname);
})();
