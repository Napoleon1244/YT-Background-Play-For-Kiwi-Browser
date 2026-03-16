# 🎵 YT Background Play

> Putar YouTube & YouTube Music di background pada **Kiwi Browser** (Android).  
> Tanpa YouTube Premium. Tanpa ganti aplikasi. Langsung jalan.

![Version](https://img.shields.io/badge/versi-3.0-red?style=flat-square)
![Manifest](https://img.shields.io/badge/manifest-v3-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Kiwi%20Browser-teal?style=flat-square)
![License](https://img.shields.io/badge/lisensi-MIT-green?style=flat-square)

---

## 📱 Apa yang Bisa Dilakukan

Pindah aplikasi, matiin layar, atau ganti tab — YouTube tetap main. Berlaku untuk **youtube.com** dan **music.youtube.com**.

| Fitur | Keterangan |
|-------|-----------|
| 🎵 **Background Play** | YouTube & YT Music tetap putar saat layar mati / ganti app |
| 🖼️ **Image Proxy CDN** | Route gambar lewat CDN global — manga lebih cepat, hemat data |

---

## 🧠 Cara Kerjanya (Penjelasan Teknis)

Kebanyakan ekstensi background play gagal karena berjalan di **isolated world** Chrome — sandbox JavaScript terpisah di mana perubahan `Object.defineProperty` tidak terlihat oleh kode YouTube sendiri.

Ekstensi ini pakai pendekatan yang berbeda:

### Kunci Utama: Main World Injection

```
injector.js (isolated world)
    │
    └── inject <script src="main-world.js"> ke dalam DOM
              │
              └── berjalan di konteks JavaScript YouTube sendiri ✅
```

Dengan inject `<script>` tag langsung ke DOM halaman, `main-world.js` berjalan di **konteks JS yang sama persis dengan YouTube**. Override kita jadi beneran works.

### Teknik yang Dipakai

| Teknik | Cara Kerjanya |
|--------|-------------|
| **Page Visibility API Spoof** | `document.hidden` selalu `false`, `document.visibilityState` selalu `'visible'` |
| **visibilitychange Intercept** | `stopImmediatePropagation()` membunuh event sebelum handler YouTube sempat jalan |
| **Focus API Override** | `document.hasFocus()` selalu `true`, `window.onblur` dineutralisir |
| **Fake User Activity** | Kirim `mousemove` sintetis tiap 30 detik + `keydown` tiap 45 detik |
| **Auto-dismiss Dialog** | Otomatis klik tombol di popup "Are you still watching?" |
| **Auto-resume Guard** | Deteksi pause tidak disengaja dan resume playback (tetap menghormati pause manual) |

### Kenapa Ekstensi Lain Gagal

```js
// ❌ Ini TIDAK BERPENGARUH ke YouTube (isolated world)
Object.defineProperty(document, 'hidden', { get: () => false });

// ✅ Ini works — berjalan di konteks JS YouTube sendiri (main world)
// (hanya mungkin lewat inject <script> tag)
Object.defineProperty(document, 'hidden', { get: () => false });
```

Perbedaannya ada di **di mana** kodenya berjalan, bukan apa yang dilakukan kodenya.

---

## 🖼️ Image Proxy CDN

Fitur tambahan untuk ngebaca manga/doujin di browser dengan lebih nyaman.

Semua `<img>` di halaman akan di-route lewat CDN proxy pilihan kamu sebelum di-load browser. Hasilnya:

- **Gambar lebih cepat** — CDN cache di edge server terdekat
- **Hemat data** — wsrv.nl otomatis resize ke 900px + quality 82% → gambar 3MB jadi ~200KB
- **Bypass hotlink protection** — beberapa manga site block gambar kalau Referer-nya salah, proxy handle ini
- **Progressive load** — gambar muncul blur dulu lalu makin tajam (interlace mode)

### Proxy yang Tersedia

| Proxy | Kelebihan |
|-------|----------|
| **wsrv.nl** | Cloudflare 300+ PoP, resize + optimize, paling reliable. **Rekomendasi utama.** |
| **images.weserv.nl** | Backend sama dengan wsrv.nl, domain backup |
| **0ms.dev** | Fast proxy, simpel, cocok buat manga reader |
| **imagecdn.app** | Auto-convert ke WebP — hemat data 30–50%, bagus buat koneksi lemot |

### Optimasi Teknis (Low-End Android)

- `Set` untuk domain skiplist → O(1) lookup vs O(n) array
- URL encode cache `Map` (max 300 entries) → `encodeURIComponent` cuma dipanggil sekali per URL unik
- `WeakSet` untuk tracking gambar → auto garbage collect, tidak ada memory leak
- MutationObserver di-debounce 150ms → batch mutations, tidak spike CPU tiap DOM change
- `requestIdleCallback` untuk initial scan → tidak mengganggu render/scroll
- Skip gambar < 50px (icon/avatar) → tidak buang waktu untuk elemen UI kecil

---

## 📦 Cara Install (Kiwi Browser)

1. Download file ZIP
2. Buka **Kiwi Browser** → ketik `chrome://extensions` di address bar
3. Aktifkan **Developer Mode** (toggle kanan atas)
4. Tap **`+ (from .zip/.crx/.user.js)`**
5. Pilih file ZIP yang sudah didownload
6. Selesai! Ikon merah ▶ muncul di toolbar

---

## 📁 Struktur File

```
yt-background-extension/
├── manifest.json     # Konfigurasi ekstensi (MV3)
├── injector.js       # Isolated world: inject script tag ke DOM
├── main-world.js     # Main world: semua logika bypass background play
├── background.js     # Service worker: badge management
├── proxy.js          # Content script: image proxy optimizer
├── popup.html        # UI popup
├── popup.js          # Logika popup
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🙏 Credits

- **Vibe coded by:** [@Napoleon1244](https://github.com/Napoleon1244)
- **Dibangun dengan:** [Claude](https://claude.ai) oleh [Anthropic](https://anthropic.com)
- **Terinspirasi dari:** [mozilla/video-bg-play](https://github.com/mozilla/video-bg-play) — ekstensi Firefox original yang mempelopori teknik main-world injection

---

## ⚠️ Disclaimer

Ekstensi ini untuk keperluan pribadi. Terms of Service YouTube mungkin membatasi background playback tanpa Premium. Gunakan dengan bijak.

---

<p align="center">Dibuat dengan 🗿 dan begadang di Kiwi Browser · Android 7.1.1 power user gang</p>
