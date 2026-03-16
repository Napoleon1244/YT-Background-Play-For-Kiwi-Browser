# 🎵 YT Background Play

> Play YouTube & YouTube Music in the background on **Kiwi Browser** (Android).  
> No YouTube Premium needed. No app switching. Just works.

![Version](https://img.shields.io/badge/version-3.0-red?style=flat-square)
![Manifest](https://img.shields.io/badge/manifest-v3-blue?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Kiwi%20Browser-teal?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

---

## 📱 What It Does

Switch to another app, turn off your screen, or change tabs — YouTube keeps playing. Works on both **youtube.com** and **music.youtube.com**.

---

## 🧠 How It Actually Works (The Technical Story)

Most "background play" extensions fail because they run in Chrome's **isolated world** — a separate JavaScript sandbox where `Object.defineProperty` changes are invisible to YouTube's own code.

This extension uses a different approach:

### The Key: Main World Injection

```
injector.js (isolated world)
    │
    └── injects <script src="main-world.js"> into the DOM
              │
              └── executes in YouTube's OWN JavaScript context ✅
```

By injecting a `<script>` tag directly into the page DOM, `main-world.js` runs in the **same JavaScript context as YouTube itself**. Now our overrides actually work.

### Techniques Used

| Technique | What It Does |
|-----------|-------------|
| **Page Visibility API Spoof** | `document.hidden` always returns `false`, `document.visibilityState` always returns `'visible'` |
| **visibilitychange Intercept** | `stopImmediatePropagation()` kills the event before YouTube's handlers fire |
| **Focus API Override** | `document.hasFocus()` always returns `true`, `window.onblur` neutralized |
| **Fake User Activity** | Dispatches synthetic `mousemove` every 30s + `keydown` every 45s |
| **Auto-dismiss Dialog** | Automatically clicks away "Are you still watching?" popups |
| **Auto-resume Guard** | Detects unexpected pauses and resumes playback (respects manual pause) |

---

## 📦 Installation (Kiwi Browser)

1. Download `yt-background-play.zip`
2. Open **Kiwi Browser** → address bar → `chrome://extensions`
3. Enable **Developer Mode** (top right toggle)
4. Tap **`+ (from .zip/.crx/.user.js)`**
5. Select the downloaded ZIP
6. Done! Red ▶ icon appears in toolbar

---

## 📁 File Structure

```
yt-background-extension/
├── manifest.json       # Extension config (MV3)
├── injector.js         # Isolated world: injects script tag into DOM
├── main-world.js       # Main world: all the actual bypass logic
├── background.js       # Service worker: badge management
├── popup.html          # UI popup
├── popup.js            # Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🔬 Why Other Extensions Fail

```js
// ❌ This does NOTHING to YouTube (isolated world)
Object.defineProperty(document, 'hidden', { get: () => false });

// ✅ This works — runs in YouTube's own JS context (main world)
// (only possible via <script> tag injection)
Object.defineProperty(document, 'hidden', { get: () => false });
```

The difference is **where** the code runs, not what the code does.

---

## 🙏 Credits

- **Vibe coded by:** [@Napoleon1244](https://github.com/https://github.com/Napoleon1244)
- **Built with:** [Claude](https://claude.ai) by [Anthropic](https://anthropic.com)
- **Inspired by:** [mozilla/video-bg-play](https://github.com/mozilla/video-bg-play) — the original Firefox extension that pioneered the main-world injection technique

---

## ⚠️ Disclaimer

This extension is for personal use. YouTube's Terms of Service may restrict background playback without Premium. Use responsibly.

---

<p align="center">Made with 🗿 and sleepless nights on Kiwi Browser</p>
