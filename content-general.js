// LoveSpark Popup Blocker — content-general.js
// Runs in ISOLATED world at document_start on all pages.
// Bridges blocked-popup events from MAIN world to the background service worker.
'use strict';

(function () {
  // ── Bridge: listen for main-world messages ──────────────────────────────

  let enabled = true; // optimistic default; updated from storage below

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || !event.data.__ls) return;

    var msg = event.data;

    if (msg.__ls === 'popupBlocked' && enabled) {
      chrome.runtime.sendMessage({
        action: 'popupBlocked',
        url: msg.url
      }).catch(function () {});
    }
  });

  // ── Sync enabled state from storage ────────────────────────────────────

  chrome.storage.local.get('isEnabled', function (data) {
    enabled = data.isEnabled !== false;
    if (!enabled) {
      _setMainWorldEnabled(false);
    }
  });

  // ── Listen for toggle changes from background.js ────────────────────────

  chrome.runtime.onMessage.addListener(function (message) {
    if (message.action === 'enabledChanged') {
      enabled = message.enabled;
      _setMainWorldEnabled(message.enabled);
    }
  });

  function _setMainWorldEnabled(value) {
    window.postMessage({ __ls: 'setEnabled', enabled: value }, '*');
  }
})();
