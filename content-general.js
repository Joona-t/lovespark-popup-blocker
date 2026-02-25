// LoveSpark Popup Blocker — content-general.js
// Runs in ISOLATED world at document_start on all pages.
// Injects a MAIN world script to intercept window.open, then bridges
// blocked-popup events back to the background service worker.
'use strict';

(function () {
  // ── Inject MAIN world override ──────────────────────────────────────────
  // We create a <script> element so the code runs in the page's JS context,
  // where it can shadow window.open before any page script touches it.

  const mainWorldCode = `(function () {
    'use strict';
    if (window.__loveSparkInstalled) return;
    window.__loveSparkInstalled = true;
    window.__loveSparkEnabled = true; // updated async from storage

    const _originalOpen = window.open.bind(window);
    let _lastInteraction = 0;
    const INTERACTION_WINDOW = 1200; // ms

    function _isUserInitiated() {
      return (Date.now() - _lastInteraction) < INTERACTION_WINDOW;
    }

    // Track genuine user interactions
    ['click', 'submit', 'keydown', 'touchend', 'pointerup'].forEach(function (evt) {
      document.addEventListener(evt, function () {
        _lastInteraction = Date.now();
      }, true);
    });

    // Override window.open
    window.open = function (url, target, features) {
      if (!window.__loveSparkEnabled) {
        return _originalOpen(url, target, features);
      }
      if (_isUserInitiated()) {
        return _originalOpen(url, target, features);
      }
      // Block — report to isolated world
      window.postMessage({ __ls: 'popupBlocked', url: String(url || '') }, '*');
      return null;
    };

    // Block anchor auto-clicks with target="_blank" from non-user context
    document.addEventListener('click', function (e) {
      if (!window.__loveSparkEnabled) return;
      const a = e.target && e.target.closest('a[target="_blank"]');
      if (!a) return;
      // If the click event wasn't directly from a user (isTrusted = false),
      // and we're not in user-interaction window, block it.
      if (!e.isTrusted && !_isUserInitiated()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.postMessage({ __ls: 'popupBlocked', url: a.href || '' }, '*');
      }
    }, true);
  })();`;

  const script = document.createElement('script');
  script.textContent = mainWorldCode;
  (document.head || document.documentElement).prepend(script);
  script.remove();

  // ── Bridge: listen for main-world messages ──────────────────────────────

  let enabled = true; // optimistic default; updated from storage below

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data || !event.data.__ls) return;

    const msg = event.data;

    if (msg.__ls === 'popupBlocked' && enabled) {
      chrome.runtime.sendMessage({
        action: 'popupBlocked',
        url: msg.url
      }).catch(() => {});
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
    const s = document.createElement('script');
    s.textContent = 'window.__loveSparkEnabled = ' + (value ? 'true' : 'false') + ';';
    (document.head || document.documentElement).prepend(s);
    s.remove();
  }
})();
