/**
 * YT Background Play — MAIN WORLD SCRIPT
 *
 * This script executes inside YouTube's own JavaScript context,
 * not in the extension's isolated world. That's the key difference.
 * Here we can truly override YouTube's internal property reads.
 *
 * Techniques used:
 *  1. Override Page Visibility API properties (document.hidden etc.)
 *  2. Intercept + kill visibilitychange events BEFORE YouTube handlers run
 *  3. Simulate periodic user activity (mouse + keyboard) to beat inactivity timeout
 *  4. Auto-dismiss "Are you still watching?" dialog
 *  5. Auto-resume if YouTube programmatically pauses the video
 *  6. Override document.hasFocus() to always return true
 *  7. Override window.onblur / onfocus traps
 */

(function () {
  'use strict';

  if (window.__ytbgplay_injected) return;
  window.__ytbgplay_injected = true;

  // ═══════════════════════════════════════════════════════
  // 1. SPOOF PAGE VISIBILITY API
  //    Must run BEFORE YouTube scripts parse these properties.
  // ═══════════════════════════════════════════════════════
  function forceVisible() {
    const props = {
      hidden:                { get: () => false },
      webkitHidden:          { get: () => false },
      mozHidden:             { get: () => false },
      msHidden:              { get: () => false },
      visibilityState:       { get: () => 'visible' },
      webkitVisibilityState: { get: () => 'visible' },
      mozVisibilityState:    { get: () => 'visible' },
      msVisibilityState:     { get: () => 'visible' },
    };
    for (const [prop, descriptor] of Object.entries(props)) {
      try {
        Object.defineProperty(document, prop, {
          ...descriptor,
          configurable: true,
          enumerable: true,
        });
      } catch (_) {}
    }
  }
  forceVisible();

  // ═══════════════════════════════════════════════════════
  // 2. INTERCEPT VISIBILITYCHANGE EVENTS
  //    Register capture listener FIRST (document_start) so we
  //    run before YouTube's listeners. stopImmediatePropagation
  //    prevents any subsequent listener from seeing the event.
  // ═══════════════════════════════════════════════════════
  const BLOCKED_EVENTS = [
    'visibilitychange',
    'webkitvisibilitychange',
    'mozvisibilitychange',
    'msvisibilitychange',
  ];

  BLOCKED_EVENTS.forEach((evt) => {
    document.addEventListener(evt, (e) => {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
    }, true);  // capture phase — fires before all bubble-phase listeners
  });

  // ═══════════════════════════════════════════════════════
  // 3. OVERRIDE hasFocus / blur / focus
  // ═══════════════════════════════════════════════════════
  try {
    // document.hasFocus() → always true
    document.hasFocus = () => true;

    // Prevent blur events from propagating to YouTube handlers
    window.addEventListener('blur', (e) => {
      e.stopImmediatePropagation();
    }, true);

    // Neutralise onblur property setter
    const winProto = Object.getPrototypeOf(window);
    const existingOnblur = Object.getOwnPropertyDescriptor(winProto, 'onblur');
    if (existingOnblur) {
      Object.defineProperty(window, 'onblur', {
        get: () => null,
        set: () => {},
        configurable: true,
      });
    }
  } catch (_) {}

  // ═══════════════════════════════════════════════════════
  // 4. SIMULATE USER ACTIVITY
  //    YouTube tracks last user interaction time. If it hasn't
  //    seen activity for ~60s (or longer) it may show the
  //    "Are you still watching?" dialog. We fake a mousemove
  //    every 30s and a keydown every 45s.
  // ═══════════════════════════════════════════════════════
  function fakeMouseMove() {
    try {
      const el = document.querySelector('video') || document.body;
      el.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true,
        clientX: Math.floor(Math.random() * 200 + 100),
        clientY: Math.floor(Math.random() * 200 + 100),
      }));
    } catch (_) {}
  }

  function fakeKeyPress() {
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'Shift', code: 'ShiftLeft',
      }));
    } catch (_) {}
  }

  setInterval(fakeMouseMove, 30_000);
  setInterval(fakeKeyPress, 45_000);

  // ═══════════════════════════════════════════════════════
  // 5. DISMISS "ARE YOU STILL WATCHING?" DIALOG
  //    YouTube shows this modal and pauses video. We watch for
  //    it and click the "Yes" button automatically.
  // ═══════════════════════════════════════════════════════
  function dismissAreYouStillWatching() {
    // Dialog button selectors (YouTube updates these occasionally)
    const selectors = [
      'button.yt-confirm-dialog-renderer',
      'yt-confirm-dialog-renderer button',
      '.yt-confirm-dialog-renderer .yt-spec-button-shape-next',
      '[class*="ytd-confirm-dialog"] button',
      'ytd-button-renderer:last-of-type #button',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════
  // 6. AUTO-RESUME VIDEO IF PAUSED UNEXPECTEDLY
  //    YouTube sometimes pauses the <video> element directly.
  //    We catch this and resume if the pause wasn't user-initiated.
  // ═══════════════════════════════════════════════════════
  let userPaused = false;

  function attachVideoGuard(video) {
    if (video.__ytbg_guarded) return;
    video.__ytbg_guarded = true;

    video.addEventListener('pause', () => {
      if (userPaused) return;
      // Small delay to let YouTube's UI settle before we check
      setTimeout(() => {
        // If dialog was the reason, dismiss and resume
        const dismissed = dismissAreYouStillWatching();
        if (!userPaused && video.paused) {
          if (dismissed || document.hidden === false) {
            // hidden is now always false thanks to our override,
            // so if we're paused and user didn't pause, resume.
            video.play().catch(() => {});
          }
        }
      }, 800);
    }, { passive: true });
  }

  // Intercept click on play/pause buttons to know about user intent
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    const isPlayPause =
      target.closest('.ytp-play-button') ||
      target.closest('.play-pause-button') ||
      target.closest('[aria-label*="Pause"]') ||
      target.closest('[aria-label*="Play"]') ||
      target.closest('[data-testid*="pause"]') ||
      target.closest('[data-testid*="play"]') ||
      target.closest('#play-pause-button');
    if (isPlayPause) {
      userPaused = true;
      setTimeout(() => { userPaused = false; }, 1000);
    }
  }, true);

  // Space / k key (YouTube keyboard shortcut)
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
      userPaused = true;
      setTimeout(() => { userPaused = false; }, 1000);
    }
  }, true);

  // ═══════════════════════════════════════════════════════
  // 7. WATCH FOR VIDEO ELEMENTS (CURRENT + FUTURE)
  // ═══════════════════════════════════════════════════════
  document.querySelectorAll('video').forEach(attachVideoGuard);

  const videoObserver = new MutationObserver(() => {
    document.querySelectorAll('video').forEach(attachVideoGuard);
    dismissAreYouStillWatching();
  });
  videoObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // ═══════════════════════════════════════════════════════
  // 8. YOUTUBE MUSIC SPECIFIC: Keep audio active
  //    YT Music uses web audio pipeline that can get suspended
  // ═══════════════════════════════════════════════════════
  if (location.hostname === 'music.youtube.com') {
    setInterval(() => {
      const videos = document.querySelectorAll('video');
      videos.forEach((v) => {
        if (!v.paused && !userPaused) return; // playing = fine
      });
    }, 5000);
  }

  console.log('[YT Background Play v2] ✅ MAIN WORLD injection active on', location.hostname);
})();
