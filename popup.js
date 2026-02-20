// LoveSpark Popup Blocker — popup.js
'use strict';

const elPopups  = document.getElementById('val-popups');
const elYT      = document.getElementById('val-yt');
const toggle    = document.getElementById('toggle-enabled');
const toggleLbl = document.getElementById('toggle-label');

// ── Animate counter to a target value ──────────────────────────────────────

function animateTo(el, target) {
  const start  = parseInt(el.textContent, 10) || 0;
  if (start === target) return;

  const diff     = target - start;
  const steps    = Math.min(Math.abs(diff), 20);
  const stepSize = diff / steps;
  let   current  = start;
  let   step     = 0;

  const interval = setInterval(function () {
    step++;
    current += stepSize;
    el.textContent = Math.round(current);
    if (step >= steps) {
      clearInterval(interval);
      el.textContent = target;
      el.classList.add('ticked');
      el.addEventListener('animationend', function handler() {
        el.classList.remove('ticked');
        el.removeEventListener('animationend', handler);
      });
    }
  }, 18);
}

// ── Load and display stats ─────────────────────────────────────────────────

function loadStats() {
  chrome.runtime.sendMessage({ action: 'getStats' }, function (data) {
    if (chrome.runtime.lastError || !data) return;

    animateTo(elPopups, data.popupsBlockedToday || 0);
    animateTo(elYT,     data.ytAdsSkippedToday  || 0);

    const enabled = data.isEnabled !== false;
    toggle.checked   = enabled;
    toggleLbl.textContent = enabled ? 'Enabled' : 'Disabled';
    document.body.classList.toggle('disabled', !enabled);
  });
}

// ── Toggle handler ─────────────────────────────────────────────────────────

toggle.addEventListener('change', function () {
  const enabled = toggle.checked;
  toggleLbl.textContent = enabled ? 'Enabled' : 'Disabled';
  document.body.classList.toggle('disabled', !enabled);

  chrome.runtime.sendMessage({ action: 'setEnabled', enabled }, function () {
    if (chrome.runtime.lastError) {
      // Revert on error
      toggle.checked = !enabled;
      toggleLbl.textContent = !enabled ? 'Enabled' : 'Disabled';
      document.body.classList.toggle('disabled', enabled);
    }
  });
});

// ── Init ───────────────────────────────────────────────────────────────────

loadStats();
