// LoveSpark Popup Blocker — content-main.js
// Runs in MAIN world at document_start (via manifest).
// Multi-factor popup decision engine: gesture budget, target scoring,
// cross-origin heuristic, popunder detection, rate limiting.
'use strict';

if (!window.__loveSparkInstalled) {
  window.__loveSparkInstalled = true;
  window.__loveSparkEnabled = true;

  // ── Constants ──────────────────────────────────────────────────────────────

  var INTERACTION_WINDOW    = 400;   // ms — tight window, down from 1200
  var POPUPS_PER_GESTURE    = 1;     // max window.open calls per user gesture
  var RAPID_POPUP_WINDOW    = 2000;  // ms — global rate limit window
  var MAX_RAPID_POPUPS      = 2;     // max popups in any RAPID_POPUP_WINDOW
  var POPUNDER_FOCUS_WINDOW = 200;   // ms — detect focus-steal after popup

  // ── Popup allowlist — OAuth, payments, auth flows ─────────────────────────

  var POPUP_ALLOWLIST = [
    'paypal.com', 'stripe.com', 'accounts.google.com',
    'login.microsoftonline.com', 'appleid.apple.com', 'github.com',
    'facebook.com', 'twitter.com', 'x.com', 'auth0.com', 'okta.com',
    'discord.com', 'twitch.tv', 'slack.com', 'notion.so', 'linear.app'
  ];

  function isAllowlisted(url) {
    try {
      var domain = new URL(url, location.href).hostname.replace(/^www\./, '');
      return POPUP_ALLOWLIST.some(function (d) {
        return domain === d || domain.endsWith('.' + d);
      });
    } catch (e) { return false; }
  }

  // ── Gesture state ─────────────────────────────────────────────────────────

  var _gesture = {
    timestamp: 0,
    budget: 0,
    targetQuality: 0,
    isTrusted: false
  };

  // ── Click target quality scoring ──────────────────────────────────────────

  var INTERACTIVE_TAGS = {
    A: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, SUMMARY: 1, LABEL: 1
  };
  var INTERACTIVE_ROLES = {
    button: 1, link: 1, menuitem: 1, tab: 1, option: 1, switch: 1
  };

  function _scoreTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return 0;

    var node = el;
    for (var i = 0; i < 5 && node && node !== document.body; i++) {
      if (node.tagName && INTERACTIVE_TAGS[node.tagName]) return 2;
      var role = node.getAttribute && node.getAttribute('role');
      if (role && INTERACTIVE_ROLES[role]) return 2;
      if (node.tagName === 'DIV' || node.tagName === 'SPAN') {
        if (node.hasAttribute('onclick') || node.hasAttribute('tabindex')) return 1;
      }
      node = node.parentElement;
    }
    return 0;
  }

  // ── Gesture tracking ──────────────────────────────────────────────────────

  ['click', 'submit', 'touchend', 'pointerup'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      _gesture.timestamp = Date.now();
      _gesture.budget = POPUPS_PER_GESTURE;
      _gesture.isTrusted = e.isTrusted;
      _gesture.targetQuality = _scoreTarget(e.target);
    }, true);
  });

  document.addEventListener('keydown', function (e) {
    _gesture.timestamp = Date.now();
    _gesture.budget = POPUPS_PER_GESTURE;
    _gesture.isTrusted = e.isTrusted;
    _gesture.targetQuality = 2; // keyboard = intentional
  }, true);

  // ── Rapid-fire rate limiter ───────────────────────────────────────────────

  var _recentPopups = [];

  function _recordPopup() {
    var now = Date.now();
    _recentPopups.push(now);
    while (_recentPopups.length > 0 && now - _recentPopups[0] > RAPID_POPUP_WINDOW) {
      _recentPopups.shift();
    }
  }

  function _isRapidFire() {
    var now = Date.now();
    var count = 0;
    for (var i = _recentPopups.length - 1; i >= 0; i--) {
      if (now - _recentPopups[i] <= RAPID_POPUP_WINDOW) count++;
      else break;
    }
    return count >= MAX_RAPID_POPUPS;
  }

  // ── Cross-origin heuristic ────────────────────────────────────────────────

  function _isSameOriginish(url) {
    try {
      var target = new URL(url, location.href);
      if (target.origin === location.origin) return true;
      var curParts = location.hostname.replace(/^www\./, '').split('.');
      var tgtParts = target.hostname.replace(/^www\./, '').split('.');
      if (curParts.length >= 2 && tgtParts.length >= 2) {
        var curBase = curParts.slice(-2).join('.');
        var tgtBase = tgtParts.slice(-2).join('.');
        if (curBase === tgtBase) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  // ── Decision function ─────────────────────────────────────────────────────

  function _shouldAllow(url) {
    // 1. Allowlisted destinations always pass
    if (url && isAllowlisted(url)) return true;

    // 2. Global rate limit
    if (_isRapidFire()) return false;

    // 3. No recent gesture — block (timer/onload popups)
    if (Date.now() - _gesture.timestamp >= INTERACTION_WINDOW) return false;

    // 4. Gesture budget exhausted — block (2nd popup from same click)
    if (_gesture.budget <= 0) return false;

    // 5. Untrusted event — block (programmatic dispatchEvent)
    if (!_gesture.isTrusted) return false;

    // 6. Target quality + cross-origin analysis
    var sameOrigin = !url || _isSameOriginish(url);
    var quality = _gesture.targetQuality;

    // Interactive element (link, button): allow all
    if (quality === 2) return true;

    // Semi-interactive or non-interactive: allow same-origin only
    return sameOrigin;
  }

  // ── Override window.open ──────────────────────────────────────────────────

  var _originalOpen = window.open.bind(window);
  var _lastPopupTime = 0;
  var _lastPopupUrl = '';

  window.open = function (url, target, features) {
    if (!window.__loveSparkEnabled) return _originalOpen(url, target, features);

    if (_shouldAllow(url)) {
      _gesture.budget--;
      _recordPopup();
      _lastPopupTime = Date.now();
      _lastPopupUrl = url;
      return _originalOpen(url, target, features);
    }

    // Blocked
    window.postMessage({ __ls: 'popupBlocked', url: String(url || '') }, '*');
    return null;
  };

  // ── Popunder detection — override window.focus ────────────────────────────

  var _originalFocus = window.focus.bind(window);

  window.focus = function () {
    if (window.__loveSparkEnabled &&
        _lastPopupTime > 0 &&
        (Date.now() - _lastPopupTime) < POPUNDER_FOCUS_WINDOW) {
      _lastPopupTime = 0;
      window.postMessage({
        __ls: 'popupBlocked',
        url: String(_lastPopupUrl || '')
      }, '*');
      return;
    }
    return _originalFocus();
  };

  // ── Programmatic .click() defense ─────────────────────────────────────────

  var _originalClick = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    if (!window.__loveSparkEnabled) return _originalClick.call(this);

    if (this.tagName === 'A' && this.target === '_blank') {
      var now = Date.now();
      if (now - _gesture.timestamp >= INTERACTION_WINDOW || !_gesture.isTrusted) {
        window.postMessage({ __ls: 'popupBlocked', url: this.href || '' }, '*');
        return;
      }
    }
    return _originalClick.call(this);
  };

  // Block all untrusted click events on target="_blank" anchors
  document.addEventListener('click', function (e) {
    if (!window.__loveSparkEnabled) return;
    if (e.isTrusted) return;
    var a = e.target && e.target.closest('a[target="_blank"]');
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.postMessage({ __ls: 'popupBlocked', url: a.href || '' }, '*');
  }, true);

  // ── Listen for enable/disable from isolated world ─────────────────────────

  window.addEventListener('message', function (event) {
    if (event.source !== window || !event.data) return;
    if (event.data.__ls === 'setEnabled') {
      window.__loveSparkEnabled = !!event.data.enabled;
    }
  });
}
