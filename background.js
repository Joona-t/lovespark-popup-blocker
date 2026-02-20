// LoveSpark Popup Blocker — background.js (Service Worker)
'use strict';

// ── In-memory session counters (reset on service worker restart)
let sessionPopups = 0;
let sessionYTAds = 0;

// Domains that are allowed to open popups (OAuth, payments, etc.)
const POPUP_ALLOWLIST = new Set([
  'paypal.com', 'stripe.com', 'accounts.google.com', 'login.microsoftonline.com',
  'appleid.apple.com', 'github.com', 'facebook.com', 'twitter.com', 'x.com',
  'auth0.com', 'okta.com', 'discord.com', 'twitch.tv', 'slack.com'
]);

// Per-tab user interaction timestamps (for detecting script-initiated navigations)
const tabLastClick = new Map();

// ── Helpers ────────────────────────────────────────────────────────────────

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isAllowlisted(url) {
  const domain = getDomain(url);
  for (const allowed of POPUP_ALLOWLIST) {
    if (domain === allowed || domain.endsWith('.' + allowed)) return true;
  }
  return false;
}

async function getEnabled() {
  const data = await chrome.storage.local.get('isEnabled');
  return data.isEnabled !== false; // default true
}

async function incrementStat(key, amount = 1) {
  const data = await chrome.storage.local.get([key, 'lastResetDate']);
  const today = new Date().toISOString().slice(0, 10);

  // Daily reset
  if (data.lastResetDate !== today) {
    await chrome.storage.local.set({
      popupsBlockedToday: 0,
      ytAdsSkippedToday: 0,
      adsHiddenToday: 0,
      lastResetDate: today
    });
  }

  const todayKey = key.replace('Total', 'Today');
  const current = data[key] || 0;
  const todayData = await chrome.storage.local.get(todayKey);
  const currentToday = todayData[todayKey] || 0;

  await chrome.storage.local.set({
    [key]: current + amount,
    [todayKey]: currentToday + amount
  });

  return currentToday + amount;
}

async function updateBadge() {
  const data = await chrome.storage.local.get([
    'popupsBlockedToday', 'ytAdsSkippedToday', 'isEnabled'
  ]);

  if (data.isEnabled === false) {
    chrome.action.setBadgeText({ text: 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#666666' });
    return;
  }

  const total = (data.popupsBlockedToday || 0) + (data.ytAdsSkippedToday || 0);
  const text = total > 999 ? '999+' : total > 0 ? String(total) : '';
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: '#FF69B4' });
  chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
}

// ── Initialization ─────────────────────────────────────────────────────────

async function initStorage() {
  const data = await chrome.storage.local.get([
    'popupsBlockedTotal', 'ytAdsSkippedTotal', 'adsHiddenTotal',
    'popupsBlockedToday', 'ytAdsSkippedToday', 'adsHiddenToday',
    'lastResetDate', 'isEnabled'
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const defaults = {};

  if (data.popupsBlockedTotal === undefined) defaults.popupsBlockedTotal = 0;
  if (data.ytAdsSkippedTotal === undefined) defaults.ytAdsSkippedTotal = 0;
  if (data.adsHiddenTotal === undefined) defaults.adsHiddenTotal = 0;
  if (data.popupsBlockedToday === undefined) defaults.popupsBlockedToday = 0;
  if (data.ytAdsSkippedToday === undefined) defaults.ytAdsSkippedToday = 0;
  if (data.adsHiddenToday === undefined) defaults.adsHiddenToday = 0;
  if (data.lastResetDate === undefined) defaults.lastResetDate = today;
  if (data.isEnabled === undefined) defaults.isEnabled = true;

  // Reset daily counts if it's a new day
  if (data.lastResetDate && data.lastResetDate !== today) {
    defaults.popupsBlockedToday = 0;
    defaults.ytAdsSkippedToday = 0;
    defaults.adsHiddenToday = 0;
    defaults.lastResetDate = today;
  }

  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }

  await updateBadge();
}

// ── webNavigation: Catch script-opened tabs ────────────────────────────────

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (details) => {
  if (!await getEnabled()) return;

  const sourceTab = details.sourceTabId;
  const sourceUrl = details.url || '';

  // Allow if it's an allowlisted destination
  if (isAllowlisted(sourceUrl)) return;

  // Allow if the source tab had a user interaction within the last 2 seconds
  const lastClick = tabLastClick.get(sourceTab);
  if (lastClick && (Date.now() - lastClick) < 2000) return;

  // Block: close the newly created tab
  try {
    await chrome.tabs.remove(details.tabId);
    sessionPopups++;
    await incrementStat('popupsBlockedTotal');
    await updateBadge();
  } catch (e) {
    // Tab may have already closed or doesn't exist
  }
});

// ── Track user clicks per tab ──────────────────────────────────────────────

chrome.tabs.onActivated.addListener((activeInfo) => {
  // Clean up old entries
  const cutoff = Date.now() - 10000;
  for (const [tabId, ts] of tabLastClick.entries()) {
    if (ts < cutoff) tabLastClick.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabLastClick.delete(tabId);
});

// ── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.action) {
      case 'userClick': {
        if (sender.tab?.id) {
          tabLastClick.set(sender.tab.id, Date.now());
        }
        sendResponse({ ok: true });
        break;
      }

      case 'popupBlocked': {
        if (!await getEnabled()) { sendResponse({ ok: false }); break; }
        sessionPopups++;
        const todayCount = await incrementStat('popupsBlockedTotal');
        await updateBadge();
        sendResponse({ ok: true, todayCount });
        break;
      }

      case 'ytAdSkipped': {
        if (!await getEnabled()) { sendResponse({ ok: false }); break; }
        sessionYTAds++;
        const todayCount = await incrementStat('ytAdsSkippedTotal');
        await updateBadge();
        sendResponse({ ok: true, todayCount });
        break;
      }

      case 'getStats': {
        const data = await chrome.storage.local.get([
          'popupsBlockedTotal', 'ytAdsSkippedTotal', 'adsHiddenTotal',
          'popupsBlockedToday', 'ytAdsSkippedToday', 'adsHiddenToday',
          'isEnabled'
        ]);
        sendResponse({ ...data });
        break;
      }

      case 'setEnabled': {
        const enabled = message.enabled;
        await chrome.storage.local.set({ isEnabled: enabled });

        // Toggle declarativeNetRequest ruleset
        try {
          if (enabled) {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
              enableRulesetIds: ['ruleset_1']
            });
          } else {
            await chrome.declarativeNetRequest.updateEnabledRulesets({
              disableRulesetIds: ['ruleset_1']
            });
          }
        } catch (e) {
          // Ruleset update failed (already in desired state)
        }

        // Notify all content scripts of the new state
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              action: 'enabledChanged',
              enabled
            }).catch(() => {}); // Ignore errors for tabs without content scripts
          }
        }

        await updateBadge();
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown action' });
    }
  })();

  return true; // Keep message channel open for async response
});

// ── Startup ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(initStorage);
chrome.runtime.onStartup.addListener(initStorage);

// Run on service worker boot
initStorage();
