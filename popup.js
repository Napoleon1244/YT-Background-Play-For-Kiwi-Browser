'use strict';

// ── YT Status ──────────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const dot    = document.getElementById('dot');
  const stitle = document.getElementById('stitle');
  const ssub   = document.getElementById('ssub');
  if (!tab?.url) { stitle.textContent = 'Tidak ada tab aktif'; return; }
  const isYTM = tab.url.includes('music.youtube.com');
  const isYT  = tab.url.includes('youtube.com') && !isYTM;
  if (isYT || isYTM) {
    dot.classList.add('on');
    stitle.textContent = '🟢 Background Play Aktif';
    ssub.textContent   = isYTM ? 'YouTube Music siap play di background!' : 'YouTube siap play di background!';
  } else {
    stitle.textContent = '⚪ Bukan halaman YouTube';
    ssub.textContent   = 'Background play aktif saat buka YouTube';
  }
});

chrome.tabs.query({}, (tabs) => {
  const n = tabs.filter(t => t.url?.includes('youtube.com')).length;
  if (n) document.getElementById('tabinfo').textContent = n + ' YT tab';
});

// ── Image Proxy Selection ──────────────────────────────────────
const PROXY_NAMES = {
  none:     'OFF',
  wsrv:     'wsrv.nl',
  '0ms':    '0ms.dev',
  weserv:   'weserv.nl',
  imagecdn: 'imagecdn',
};

const badge  = document.getElementById('proxy-status-badge');
const opts   = document.querySelectorAll('.proxy-opt');

function selectProxy(proxyVal) {
  // Update UI
  opts.forEach(opt => {
    opt.classList.toggle('selected', opt.dataset.proxy === proxyVal);
  });

  // Update badge
  if (proxyVal === 'none') {
    badge.textContent  = 'OFF';
    badge.className    = 'proxy-badge-off';
  } else {
    badge.textContent  = PROXY_NAMES[proxyVal] || proxyVal;
    badge.className    = 'proxy-badge-active';
  }

  // Save to storage (proxy.js listens for this change)
  chrome.storage.local.set({ imageProxy: proxyVal });
}

// Load saved proxy
chrome.storage.local.get(['imageProxy'], ({ imageProxy }) => {
  selectProxy(imageProxy || 'none');
});

// Handle clicks
opts.forEach(opt => {
  opt.addEventListener('click', () => selectProxy(opt.dataset.proxy));
});

