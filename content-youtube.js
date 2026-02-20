// LoveSpark Popup Blocker — content-youtube.js
// Runs at document_idle on YouTube only.
// Skips pre-roll / mid-roll video ads and reports to background.
'use strict';

(function () {
  let enabled = true;
  let playerObserver = null;
  let adCheckInterval = null;

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

  // ── Ad skip logic ─────────────────────────────────────────────────────────

  function skipAd() {
    const player = document.querySelector('.html5-video-player');
    if (!player) return false;

    const isShowingAd = player.classList.contains('ad-showing') ||
                        player.classList.contains('ad-interrupting');
    if (!isShowingAd) return false;

    const video = document.querySelector('video');
    if (video) {
      // Jump to the end of the ad video to trigger "ad done" state
      try {
        if (video.duration && isFinite(video.duration)) {
          video.currentTime = video.duration;
        }
      } catch (_) {}
      video.muted = true; // Immediate relief even if seeking fails
    }

    // Click any available skip button
    const skipSelectors = [
      '.ytp-ad-skip-button',
      '.ytp-ad-skip-button-modern',
      '.ytp-skip-ad-button',
      '.ytp-ad-skip-button-slot button',
      '[class*="ytp-ad-skip"]'
    ];
    for (const sel of skipSelectors) {
      const btn = document.querySelector(sel);
      if (btn) {
        btn.click();
        break;
      }
    }

    return true;
  }

  function onAdSkipped() {
    chrome.runtime.sendMessage({ action: 'ytAdSkipped' }).catch(() => {});
    // Restore audio after ad
    const video = document.querySelector('video');
    if (video) {
      setTimeout(function () {
        const player = document.querySelector('.html5-video-player');
        if (player && !player.classList.contains('ad-showing')) {
          video.muted = false;
        }
      }, 300);
    }
  }

  // ── MutationObserver: watch player class for ad-showing ──────────────────

  function observePlayer() {
    const player = document.querySelector('.html5-video-player');
    if (!player) return;

    if (playerObserver) playerObserver.disconnect();

    playerObserver = new MutationObserver(function (mutations) {
      if (!enabled) return;
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const target = mutation.target;
          if (target.classList.contains('ad-showing') ||
              target.classList.contains('ad-interrupting')) {
            const skipped = skipAd();
            if (skipped) {
              // Debounce: only report once per ad
              setTimeout(onAdSkipped, 500);
            }
          }
        }
      }
    });

    playerObserver.observe(player, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: false
    });

    // Also observe the overlay container for late-appearing skip buttons
    const overlay = document.querySelector('.ytp-ad-player-overlay, .video-ads');
    if (overlay) {
      playerObserver.observe(overlay, {
        childList: true,
        subtree: true
      });
    }
  }

  // ── Polling fallback: catch ads MutationObserver might miss ──────────────

  function startPolling() {
    if (adCheckInterval) clearInterval(adCheckInterval);
    adCheckInterval = setInterval(function () {
      if (!enabled) return;
      const player = document.querySelector('.html5-video-player');
      if (player && (player.classList.contains('ad-showing') ||
                     player.classList.contains('ad-interrupting'))) {
        skipAd();
      }
    }, 300);
  }

  // ── YouTube SPA navigation ────────────────────────────────────────────────

  function reinitialize() {
    // Give the new page DOM a moment to settle
    setTimeout(function () {
      observePlayer();
    }, 800);
  }

  // ── Init / Teardown ───────────────────────────────────────────────────────

  function init() {
    observePlayer();
    startPolling();

    // YouTube SPA navigation events
    document.addEventListener('yt-navigate-finish', reinitialize);
    document.addEventListener('yt-page-data-updated', reinitialize);

    // Immediate check in case we loaded mid-ad
    skipAd();
  }

  function teardown() {
    if (playerObserver) {
      playerObserver.disconnect();
      playerObserver = null;
    }
    if (adCheckInterval) {
      clearInterval(adCheckInterval);
      adCheckInterval = null;
    }
    document.removeEventListener('yt-navigate-finish', reinitialize);
    document.removeEventListener('yt-page-data-updated', reinitialize);
  }
})();
