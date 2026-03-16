/**
 * YT Background Play — MAIN WORLD SCRIPT
 *
 * Jalan di dalam JavaScript context YouTube sendiri (bukan isolated world).
 * Di sini kita bisa benar-benar override property reads internal YouTube.
 *
 * Teknik yang dipakai:
 *  1. Override Page Visibility API (document.hidden, visibilityState)
 *  2. Intercept + kill visibilitychange events sebelum YouTube handler-nya
 *  3. Simulasi periodic user activity (mouse + keyboard)
 *  4. Auto-dismiss dialog "Are you still watching?"
 *  5. Auto-resume kalau YouTube pause video secara programatik
 *  6. Override document.hasFocus() → selalu true
 *  7. Override window.onblur / onfocus traps
 *
 * AUDIT FIX:
 *  - Hapus YT Music setInterval (section 8 asli) — itu dead code, tidak
 *    melakukan apapun (loop forEach yang hanya punya early-return, tidak ada
 *    aksi untuk kasus video.paused). Menyia-nyiakan querySelectorAll tiap 5 detik.
 */

(function () {
  'use strict';

  if (window.__ytbgplay_injected) return;
  window.__ytbgplay_injected = true;

  // ═══════════════════════════════════════════════════════
  // 1. SPOOF PAGE VISIBILITY API
  //    Harus jalan SEBELUM script YouTube parse property ini.
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
    }, true);
  });

  // ═══════════════════════════════════════════════════════
  // 3. OVERRIDE hasFocus / blur / focus
  // ═══════════════════════════════════════════════════════
  try {
    document.hasFocus = () => true;

    window.addEventListener('blur', (e) => {
      e.stopImmediatePropagation();
    }, true);

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
  // 4. SIMULASI USER ACTIVITY
  //    YouTube track waktu interaksi terakhir. Kita fake
  //    mousemove tiap 30s dan keydown tiap 45s.
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
  // 5. DISMISS DIALOG "ARE YOU STILL WATCHING?"
  // ═══════════════════════════════════════════════════════
  function dismissAreYouStillWatching() {
    const selectors = [
      'button.yt-confirm-dialog-renderer',
      'yt-confirm-dialog-renderer button',
      '.yt-confirm-dialog-renderer .yt-spec-button-shape-next',
      '[class*="ytd-confirm-dialog"] button',
      'ytd-button-renderer:last-of-type #button',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn) { btn.click(); return true; }
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════
  // 6. AUTO-RESUME VIDEO KALAU DIPAUSE TIDAK SENGAJA
  // ═══════════════════════════════════════════════════════
  let userPaused = false;

  function attachVideoGuard(video) {
    if (video.__ytbg_guarded) return;
    video.__ytbg_guarded = true;

    video.addEventListener('pause', () => {
      if (userPaused) return;
      setTimeout(() => {
        const dismissed = dismissAreYouStillWatching();
        if (!userPaused && video.paused) {
          if (dismissed || document.hidden === false) {
            video.play().catch(() => {});
          }
        }
      }, 800);
    }, { passive: true });
  }

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

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.key === 'k' || e.key === 'K') {
      userPaused = true;
      setTimeout(() => { userPaused = false; }, 1000);
    }
  }, true);

  // ═══════════════════════════════════════════════════════
  // 7. WATCH VIDEO ELEMENTS (CURRENT + FUTURE)
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

  console.log('[YT Background Play v2] ✅ MAIN WORLD injection active on', location.hostname);
})();
