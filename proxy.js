'use strict';

/**
 * proxy.js v2 — Optimized Image Proxy for low-end Android
 *
 * Optimizations vs v1:
 *  ✅ Skip tiny images (icons/avatars < 50px) — gak perlu di-proxy
 *  ✅ URL cache Map — hindari encode URL yang sama berkali-kali
 *  ✅ Debounced MutationObserver — batch mutations, gak fire tiap DOM change
 *  ✅ requestIdleCallback — initial scan jalan saat browser idle, gak block render
 *  ✅ wsrv.nl resize w=900&q=82 — gambar 3MB jadi ~200KB, tetap tajam di HP
 *  ✅ Hapus getComputedStyle loop — itu operasi mahal, skip CSS bg images
 *  ✅ Set-based skiplist — O(1) domain check vs O(n) array.some()
 *  ✅ WeakSet buat proxied tracking — gak bikin memory leak
 */

// ── Domain skiplist — O(1) lookup ─────────────────────────────
const SKIP = new Set([
  'youtube.com','music.youtube.com','youtu.be',
  'google.com','gstatic.com','googleapis.com','googleusercontent.com',
  'wsrv.nl','images.weserv.nl','0ms.dev','imagecdn.app',
  'gravatar.com','wp.com','wordpress.com',
]);

const host = location.hostname.replace(/^www\./, '');
const isSkipped = SKIP.has(host) ||
  [...SKIP].some(s => host.endsWith('.' + s)) ||
  location.protocol === 'chrome-extension:' ||
  location.protocol === 'moz-extension:' ||
  location.protocol === 'data:';

if (!isSkipped) initProxy();

// ── URL encode cache — avoid redundant encodeURIComponent calls ─
const urlCache = new Map();
const MAX_CACHE = 300; // cap memory

function buildProxyUrl(proxy, raw) {
  if (!raw || raw.length < 12) return null;
  // Fast pre-check without try/catch
  if (raw[0] === 'd' || raw[0] === 'b') return null; // data: blob:
  if (raw.includes('wsrv.nl') || raw.includes('0ms.dev') ||
      raw.includes('weserv.nl') || raw.includes('imagecdn.app')) return null;

  const cacheKey = proxy + raw;
  if (urlCache.has(cacheKey)) return urlCache.get(cacheKey);

  let result = null;
  try {
    const abs = raw.startsWith('http') ? raw : new URL(raw, location.href).href;
    if (!abs.startsWith('http')) return null;
    const enc = encodeURIComponent(abs);

    switch (proxy) {
      case 'wsrv':
        // w=900  → resize ke max 900px lebar (cukup buat layar HP)
        // q=82   → quality 82% — gak keliatan bedanya tapi 40-60% lebih kecil
        // il     → interlace/progressive load (gambar muncul blur dulu, lama-lama tajam)
        // n=-1   → support animated GIF
        result = `https://wsrv.nl/?url=${enc}&w=900&q=82&il&n=-1`;
        break;
      case '0ms':
        result = `https://0ms.dev/?url=${enc}`;
        break;
      case 'weserv':
        result = `https://images.weserv.nl/?url=${enc}&w=900&q=82&il&n=-1`;
        break;
      case 'imagecdn':
        // WebP auto-convert — paling hemat data, tapi gak semua browser lama support
        result = `https://imagecdn.app/v2/image/${enc}`;
        break;
    }
  } catch (_) {}

  if (result) {
    if (urlCache.size >= MAX_CACHE) {
      // Evict oldest entry (first key) — simple LRU-lite
      urlCache.delete(urlCache.keys().next().value);
    }
    urlCache.set(cacheKey, result);
  }
  return result;
}

// ── WeakSet — no memory leak for detached nodes ────────────────
const proxied = new WeakSet();

// Lazy-load attribute names to check (order: most common first)
const LAZY_ATTRS = [
  'data-src', 'data-lazy-src', 'data-cfsrc',
  'data-original', 'data-lazy', 'data-bg',
];

function rewriteImg(img, proxy) {
  if (proxied.has(img)) return;

  // ── Skip tiny images (icons, avatars, UI elements) ───────────
  // naturalWidth/Height = 0 means not loaded yet — check layout size instead
  const w = img.naturalWidth  || img.width  || img.clientWidth;
  const h = img.naturalHeight || img.height || img.clientHeight;
  // Only skip if we know it's small — if 0,0 we can't tell, so proceed
  if ((w > 0 && w < 50) || (h > 0 && h < 50)) return;

  proxied.add(img);

  // Check lazy-load attrs first (they have the real URL)
  for (const attr of LAZY_ATTRS) {
    const val = img.getAttribute(attr);
    if (!val) continue;
    const p = buildProxyUrl(proxy, val);
    if (p) img.setAttribute(attr, p);
  }

  // Then src
  const src = img.getAttribute('src');
  if (src) {
    const p = buildProxyUrl(proxy, src);
    if (p) img.src = p;
  }

  // srcset (less common on manga sites, handle briefly)
  const ss = img.getAttribute('srcset');
  if (ss) {
    img.setAttribute('srcset', ss.replace(
      /(https?:\/\/[^\s,]+)/g,
      url => buildProxyUrl(proxy, url) || url
    ));
  }
}

// ── Debounced MutationObserver ─────────────────────────────────
// Instead of processing every single DOM mutation immediately,
// batch them into one pass every 150ms — much lighter on CPU.
function applyProxy(proxy) {
  let pendingImgs = [];
  let rafId = null;

  function flushPending() {
    rafId = null;
    const imgs = pendingImgs;
    pendingImgs = [];
    for (const img of imgs) rewriteImg(img, proxy);
  }

  function scheduleFlush() {
    if (!rafId) rafId = setTimeout(flushPending, 150);
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IMG') {
            pendingImgs.push(node);
          } else {
            // querySelectorAll only if node has children — avoid cost on leaf nodes
            if (node.firstElementChild) {
              const imgs = node.querySelectorAll('img');
              if (imgs.length) pendingImgs.push(...imgs);
            }
          }
        }
      } else if (m.type === 'attributes') {
        const t = m.target;
        if (t.tagName === 'IMG') {
          proxied.delete(t); // allow re-processing on src change
          pendingImgs.push(t);
        }
      }
    }
    if (pendingImgs.length) scheduleFlush();
  });

  observer.observe(document.documentElement, {
    childList:       true,
    subtree:         true,
    attributes:      true,
    attributeFilter: ['src', 'data-src', 'data-lazy-src', 'data-original', 'data-cfsrc'],
  });

  // ── Initial DOM scan via requestIdleCallback ─────────────────
  // Runs during browser idle time — gak ganggu render/scroll
  const scanAll = () => {
    const imgs = document.querySelectorAll('img');
    const BATCH = 20; // process 20 imgs at a time, yield between batches
    let i = 0;
    function nextBatch(deadline) {
      while (i < imgs.length && (deadline?.timeRemaining() > 2 || !deadline)) {
        rewriteImg(imgs[i++], proxy);
      }
      if (i < imgs.length) {
        if (window.requestIdleCallback) requestIdleCallback(nextBatch, { timeout: 500 });
        else setTimeout(() => nextBatch(null), 50);
      }
    }
    if (window.requestIdleCallback) requestIdleCallback(nextBatch, { timeout: 500 });
    else setTimeout(() => nextBatch(null), 100);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAll, { once: true });
  } else {
    scanAll();
  }
}

// ── Init ───────────────────────────────────────────────────────
function initProxy() {
  let currentObserver = null;

  chrome.storage.local.get(['imageProxy'], ({ imageProxy }) => {
    if (imageProxy && imageProxy !== 'none') applyProxy(imageProxy);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.imageProxy) return;
    const val = changes.imageProxy.newValue;
    if (!val || val === 'none') {
      location.reload();
    } else {
      applyProxy(val);
    }
  });
}

