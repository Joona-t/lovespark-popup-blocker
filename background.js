// LoveSpark Popup Blocker — background.js (Service Worker)
'use strict';

// ── In-memory session counter (reset on service worker restart)
let sessionYTAds = 0;

// ── Helpers ────────────────────────────────────────────────────────────────

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

// ── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.action) {
      case 'popupBlocked': {
        if (!await getEnabled()) { sendResponse({ ok: false }); break; }
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
