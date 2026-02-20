// LoveSpark Popup Blocker — content-youtube.js
// Runs at document_idle on YouTube only.
//
// Counter accuracy note:
//   ytAdsSkippedToday is ONLY incremented here, when .html5-video-player
//   has the .ad-showing class and we physically seek the video to its end.
//   Network-level blocks (rules.json / declarativeNetRequest) are silent and
//   never touch this counter — they have no JS surface to report through.
//
// Maintenance note:
//   YouTube periodically renames ad-related class names (.ad-showing,
//   .ytp-ad-skip-button, etc.). The PLAYER_AD_CLASSES and SKIP_BTN_SELECTORS
//   constants below are the first place to update when skipping breaks.
'use strict';

(function () {
  let enabled = true;
  let playerObserver = null;
  let adCheckInterval = null;

  // ── Selector constants — update here when YouTube renames classes ─────────

  // Classes that appear on .html5-video-player while an ad plays.
  // Primary signal: .ad-showing. .ad-interrupting covers mid-roll bumpers.
  const PLAYER_AD_CLASSES = ['ad-showing', 'ad-interrupting'];

  // Skip button selectors, most-specific first.
  const SKIP_BTN_SELECTORS = [
    '.ytp-ad-skip-button-modern',
    '.ytp-ad-skip-button',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '[class*="ytp-ad-skip"]'
  ];

  // ── Deduplication — prevent double-counting when MutationObserver AND ────
  // polling both fire for the same ad event (observer fires on class add,
  // polling may already be mid-interval for the same state).
  let lastSkipReportedAt = 0;
  const MIN_SKIP_INTERVAL_MS = 4000; // one ad = one count, even if two paths fire

  // ── Enabled state ─────────────────────────────────────────────────────────

  chrome.storage.local.get('isEnabled', function (data) {
    enabled = data.isEnabled !== false;
    if (enabled) init();
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (message.action !== 'enabledChanged') return;
    enabled = message.enabled;
    if (enabled) {
      init();
    } else {
      teardown();
    }
  });

  // ── Core skip: returns true only when .ad-showing is present AND ──────────
  // we successfully initiated a seek or button click.
  // This is the gate that determines whether the counter increments.

  function attemptSkip() {
    const player = document.querySelector('.html5-video-player');
    if (!player) return false;

    const isAd = PLAYER_AD_CLASSES.some(cls => player.classList.contains(cls));
    if (!isAd) return false;

    let didSkip = false;

    const video = document.querySelector('video');
    if (video && isFinite(video.duration) && video.duration > 0) {
      try {
        video.currentTime = video.duration; // primary skip method
        didSkip = true;
      } catch (_) {}
      video.muted = true; // immediate audio relief while seek propagates
    }

    for (const sel of SKIP_BTN_SELECTORS) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        didSkip = true;
        break;
      }
    }

    return didSkip;
  }

  // ── Report a skipped ad — with dedup guard ────────────────────────────────
  // Only increments ytAdsSkippedToday. Never called from network-level code.

  function reportSkip() {
    const now = Date.now();
    if (now - lastSkipReportedAt < MIN_SKIP_INTERVAL_MS) return; // same ad, skip double-count
    lastSkipReportedAt = now;

    chrome.runtime.sendMessage({ action: 'ytAdSkipped' }).catch(() => {});

    // Restore audio once the ad state clears
    const video = document.querySelector('video');
    if (video) {
      setTimeout(function () {
        const player = document.querySelector('.html5-video-player');
        if (player && !PLAYER_AD_CLASSES.some(cls => player.classList.contains(cls))) {
          video.muted = false;
        }
      }, 400);
    }
  }

  // ── MutationObserver: primary detection path ──────────────────────────────
  // Watches .html5-video-player's class attribute. Fires the instant
  // .ad-showing is added, before any frames of the ad render.

  function observePlayer() {
    const player = document.querySelector('.html5-video-player');
    if (!player) return;

    if (playerObserver) playerObserver.disconnect();

    playerObserver = new MutationObserver(function (mutations) {
      if (!enabled) return;
      for (const mutation of mutations) {
        if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') continue;
        if (PLAYER_AD_CLASSES.some(cls => mutation.target.classList.contains(cls))) {
          if (attemptSkip()) {
            setTimeout(reportSkip, 400); // slight delay so seek can register
          }
          return; // one response per mutation batch is enough
        }
      }
    });

    playerObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false
    });
  }

  // ── Polling fallback: catches ads the MutationObserver might miss ─────────
  // (e.g. if the script loads after .ad-showing was already set, or if
  // YouTube fires no class mutation on mid-roll start in some versions).
  // Reports via the same reportSkip() path with the same dedup guard,
  // so it never double-counts with the observer.

  function startPolling() {
    if (adCheckInterval) clearInterval(adCheckInterval);
    adCheckInterval = setInterval(function () {
      if (!enabled) return;
      if (attemptSkip()) {
        reportSkip(); // dedup guard inside reportSkip() prevents double-count
      }
    }, 500);
  }

  // ── YouTube SPA navigation ────────────────────────────────────────────────

  function reinitialize() {
    setTimeout(observePlayer, 800); // let new page DOM settle
  }

  // ── Init / Teardown ───────────────────────────────────────────────────────

  function init() {
    observePlayer();
    startPolling();
    document.addEventListener('yt-navigate-finish', reinitialize);
    document.addEventListener('yt-page-data-updated', reinitialize);
    // Check immediately in case the script loaded mid-ad
    if (attemptSkip()) reportSkip();
  }

  function teardown() {
    if (playerObserver) { playerObserver.disconnect(); playerObserver = null; }
    if (adCheckInterval) { clearInterval(adCheckInterval); adCheckInterval = null; }
    document.removeEventListener('yt-navigate-finish', reinitialize);
    document.removeEventListener('yt-page-data-updated', reinitialize);
  }
})();
