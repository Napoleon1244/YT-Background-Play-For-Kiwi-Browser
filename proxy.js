'use strict';

/**
 * proxy.js v2.3 — Sequential Load
 *
 * Fitur baru:
 *  - Mode "Muat Berurutan": gambar dimuat satu per satu dari atas ke bawah
 *    (urutan DOM = urutan visual atas→bawah di manga/artikel).
 *    Tanpa ini: 30 halaman manga hit CDN serentak → banyak gagal/lambat.
 *    Dengan ini: halaman 1 selesai dulu → baru halaman 2 mulai, dst.
 *  - Setting disimpan di chrome.storage.local key 'seqLoad' (boolean)
 *  - Bisa dikombinasikan dengan proxy mana saja, atau bahkan tanpa proxy
 *    (sequential mode berlaku ke src asli juga, cukup efektif untuk
 *    situs yang rate-limit concurrent requests)
 *
 * Fix history:
 *  v2.1: FIX1 startsWith data:/blob:, FIX2 onerror fallback,
 *        FIX3 observer re-queue loop, FIX4 observer numpuk
 *  v2.2: FIX5 onerror → proxied.delete → infinite loop (WeakSet `failed`)
 *  v2.3: Sequential load queue
 */

// ── Domain skiplist ────────────────────────────────────────────
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

// ── Proxy domain set ───────────────────────────────────────────
const PROXY_DOMAINS = ['wsrv.nl', '0ms.dev', 'weserv.nl', 'imagecdn.app'];

function isAlreadyProxied(url) {
  if (!url) return false;
  return PROXY_DOMAINS.some(d => url.includes(d));
}

// ── URL encode cache ───────────────────────────────────────────
const urlCache = new Map();
const MAX_CACHE = 300;

function buildProxyUrl(proxy, raw) {
  if (!raw || raw.length < 12) return null;
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return null;
  if (isAlreadyProxied(raw)) return null;

  const cacheKey = proxy + raw;
  if (urlCache.has(cacheKey)) return urlCache.get(cacheKey);

  let result = null;
  try {
    const abs = raw.startsWith('http') ? raw : new URL(raw, location.href).href;
    if (!abs.startsWith('http')) return null;
    const enc = encodeURIComponent(abs);

    switch (proxy) {
      case 'wsrv':
        result = `https://wsrv.nl/?url=${enc}&w=900&q=82&il&n=-1`;
        break;
      case '0ms':
        result = `https://0ms.dev/?url=${enc}`;
        break;
      case 'weserv':
        result = `https://images.weserv.nl/?url=${enc}&w=900&q=82&il&n=-1`;
        break;
      case 'imagecdn':
        result = `https://imagecdn.app/v2/image/${enc}`;
        break;
    }
  } catch (_) {}

  if (result) {
    if (urlCache.size >= MAX_CACHE) {
      urlCache.delete(urlCache.keys().next().value);
    }
    urlCache.set(cacheKey, result);
  }
  return result;
}

// ── Tracking WeakSets ──────────────────────────────────────────
const proxied = new WeakSet();
const failed  = new WeakSet();

const LAZY_ATTRS = [
  'data-src', 'data-lazy-src', 'data-cfsrc',
  'data-original', 'data-lazy', 'data-bg',
];

function rewriteImg(img, proxy) {
  if (proxied.has(img) || failed.has(img)) return;

  const w = img.naturalWidth  || img.width  || img.clientWidth;
  const h = img.naturalHeight || img.height || img.clientHeight;
  if ((w > 0 && w < 50) || (h > 0 && h < 50)) return;

  // Jika proxy = null/none, skip rewrite — tapi sequential mode tetap bisa
  // pakai rewriteImg untuk marking (proxied.add) tanpa mengubah src
  if (proxy) {
    proxied.add(img);

    const currentSrc = img.getAttribute('src');
    if (currentSrc && !isAlreadyProxied(currentSrc) && !img.dataset._origSrc) {
      img.dataset._origSrc = currentSrc;
    }

    if (!img._proxyErrAttached) {
      img._proxyErrAttached = true;
      const onProxyErr = function() {
        const orig = img.dataset._origSrc;
        if (!orig) return;
        img.removeEventListener('error', onProxyErr);
        img._proxyErrAttached = false;
        delete img.dataset._origSrc;
        failed.add(img);
        img.src = orig;
      };
      img.addEventListener('error', onProxyErr);
    }

    for (const attr of LAZY_ATTRS) {
      const val = img.getAttribute(attr);
      if (!val || isAlreadyProxied(val)) continue;
      const p = buildProxyUrl(proxy, val);
      if (p) img.setAttribute(attr, p);
    }

    const src = img.getAttribute('src');
    if (src && !isAlreadyProxied(src)) {
      const p = buildProxyUrl(proxy, src);
      if (p) img.src = p;
    }

    const ss = img.getAttribute('srcset');
    if (ss) {
      img.setAttribute('srcset', ss.replace(
        /(https?:\/\/[^\s,]+)/g,
        url => (!isAlreadyProxied(url) && buildProxyUrl(proxy, url)) || url
      ));
    }
  }
}

// ── Sequential Load Queue ──────────────────────────────────────
// Gambar diproses satu per satu dalam urutan DOM (= atas ke bawah).
// Tiap gambar: set src → tunggu load/error (max SEQ_TIMEOUT ms) → gambar berikutnya.
const SEQ_TIMEOUT = 12_000; // 12 detik max tunggu per gambar

function makeSeqQueue(proxy) {
  const queue  = [];   // antrian img elements (DOM order)
  let running  = false;

  async function run() {
    if (running) return;
    running = true;

    while (queue.length) {
      const img = queue.shift();
      if (!img || proxied.has(img) || failed.has(img)) continue;

      // Mark dulu sebelum rewrite supaya observer tidak re-queue
      proxied.add(img);

      // Simpan src asli untuk fallback
      const currentSrc = img.getAttribute('src');
      if (currentSrc && !isAlreadyProxied(currentSrc) && !img.dataset._origSrc) {
        img.dataset._origSrc = currentSrc;
      }

      // Attach onerror fallback
      if (!img._proxyErrAttached) {
        img._proxyErrAttached = true;
        const onProxyErr = function() {
          const orig = img.dataset._origSrc;
          if (!orig) return;
          img.removeEventListener('error', onProxyErr);
          img._proxyErrAttached = false;
          delete img.dataset._origSrc;
          failed.add(img);
          img.src = orig;
        };
        img.addEventListener('error', onProxyErr);
      }

      // Kalau ada proxy, ganti URL-nya. Kalau tidak, biarkan src asli —
      // tapi tetap tunggu load supaya urutan sequential terjaga.
      let targetSrc = img.getAttribute('src');

      if (proxy) {
        for (const attr of LAZY_ATTRS) {
          const val = img.getAttribute(attr);
          if (!val || isAlreadyProxied(val)) continue;
          const p = buildProxyUrl(proxy, val);
          if (p) img.setAttribute(attr, p);
        }

        const src = img.getAttribute('src');
        if (src && !isAlreadyProxied(src)) {
          const p = buildProxyUrl(proxy, src);
          if (p) {
            img.src = p;
            targetSrc = p;
          }
        }

        const ss = img.getAttribute('srcset');
        if (ss) {
          img.setAttribute('srcset', ss.replace(
            /(https?:\/\/[^\s,]+)/g,
            url => (!isAlreadyProxied(url) && buildProxyUrl(proxy, url)) || url
          ));
        }
      }

      // Tunggu gambar ini selesai (load atau error atau timeout)
      if (targetSrc) {
        await new Promise(resolve => {
          // Sudah selesai load sebelumnya (cache browser)
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          img.addEventListener('load',  done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, SEQ_TIMEOUT);
        });
      }
    }

    running = false;
  }

  return {
    enqueue(imgs) {
      // Tambah ke antrian, hindari duplikat
      for (const img of imgs) {
        if (!proxied.has(img) && !failed.has(img) && !queue.includes(img)) {
          queue.push(img);
        }
      }
      run();
    },
    get size() { return queue.length; },
  };
}

// ── Main applyProxy ────────────────────────────────────────────
function applyProxy(proxy, seqLoad) {
  const seqQueue = seqLoad ? makeSeqQueue(proxy) : null;

  // ── Debounced batch (mode normal) ─────────────────────────────
  let pendingImgs = [];
  let rafId = null;

  function flushPending() {
    rafId = null;
    const imgs = pendingImgs;
    pendingImgs = [];
    if (seqQueue) {
      seqQueue.enqueue(imgs);
    } else {
      for (const img of imgs) rewriteImg(img, proxy);
    }
  }

  function scheduleFlush() {
    if (!rafId) rafId = setTimeout(flushPending, 150);
  }

  // ── MutationObserver ──────────────────────────────────────────
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'IMG') {
            pendingImgs.push(node);
          } else if (node.firstElementChild) {
            const imgs = node.querySelectorAll('img');
            if (imgs.length) pendingImgs.push(...imgs);
          }
        }
      } else if (m.type === 'attributes') {
        const t = m.target;
        if (t.tagName === 'IMG') {
          const newVal = t.getAttribute(m.attributeName) || '';
          if (!isAlreadyProxied(newVal) && !failed.has(t)) {
            proxied.delete(t);
            pendingImgs.push(t);
          }
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

  // ── Initial scan ──────────────────────────────────────────────
  const scanAll = () => {
    const imgs = document.querySelectorAll('img');
    if (seqQueue) {
      // Sequential: enqueue semua sekaligus, queue proses sendiri satu-satu
      seqQueue.enqueue([...imgs]);
    } else {
      // Normal: batch via requestIdleCallback
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
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAll, { once: true });
  } else {
    scanAll();
  }

  return () => observer.disconnect();
}

// ── Init ───────────────────────────────────────────────────────
function initProxy() {
  let disconnectActive = null;

  chrome.storage.local.get(['imageProxy', 'seqLoad'], ({ imageProxy, seqLoad }) => {
    const proxy = (imageProxy && imageProxy !== 'none') ? imageProxy : null;
    // Sequential mode aktif kalau seqLoad=true, dengan proxy apapun (termasuk none)
    if (proxy || seqLoad) {
      disconnectActive = applyProxy(proxy, !!seqLoad);
    }
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.imageProxy && !changes.seqLoad) return;

    if (disconnectActive) {
      disconnectActive();
      disconnectActive = null;
    }

    // Re-read kedua setting setiap kali salah satu berubah
    chrome.storage.local.get(['imageProxy', 'seqLoad'], ({ imageProxy, seqLoad }) => {
      const proxy = (imageProxy && imageProxy !== 'none') ? imageProxy : null;
      if (proxy || seqLoad) {
        disconnectActive = applyProxy(proxy, !!seqLoad);
      } else {
        location.reload();
      }
    });
  });
}
