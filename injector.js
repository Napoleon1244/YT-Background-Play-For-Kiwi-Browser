/**
 * YT Background Play — INJECTOR (Isolated World)
 *
 * Runs in Chrome's isolated world. Satu-satunya tugasnya: inject main-world.js
 * sebagai <script> tag sungguhan supaya jalan di page's JS context (main world).
 *
 * Kenapa perlu ini: Object.defineProperty di isolated world tidak
 * mempengaruhi JS execution context milik halaman itu sendiri.
 *
 * AUDIT FIX:
 *  - Hapus if/else duplikat (kedua branch identik, tidak ada bedanya)
 *  - Hapus dispatch '__ytbg_navigate' — event ini tidak pernah didengarkan
 *    di main-world.js (dead dispatch). main-world.js sudah punya MutationObserver
 *    sendiri yang handle video baru saat SPA navigation.
 */

(function () {
  'use strict';

  function injectMainWorldScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('main-world.js');
      script.type = 'text/javascript';

      const target = document.head || document.documentElement;
      target.insertBefore(script, target.firstChild);

      script.addEventListener('load', () => { script.remove(); });
    } catch (e) {
      console.error('[YT Background Play] Injector failed:', e);
    }
  }

  injectMainWorldScript();

  // YouTube SPA — track navigation untuk logging saja
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      // main-world.js sudah punya videoObserver (MutationObserver) yang
      // otomatis attach guard ke video baru — tidak perlu dispatch event manual.
    }
  }).observe(document, { subtree: true, childList: true });

  console.log('[YT Background Play] Injector loaded on', location.hostname);
})();
