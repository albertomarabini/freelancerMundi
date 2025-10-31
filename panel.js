// panel.js (module)
import { initCalendar, setCalendarStore } from './build/calendar.bundle.js';
import { GoogleCalendarClient } from './build/GoogleCalendarClient.bundle.js';
import { CalendarStore } from './build/CalendarStore.bundle.js';
import { initSettings } from './build/settings.bundle.js';
import { initWorkroomMilestones } from './build/workroommilestones.bundle.js';
import { openCaptureDialog } from './build/capturedialog.bundle.js';
import { openPipelineDrawer, closePipelineDrawer } from './build/pipelinedrawer.bundle.js';
import { initPipeline } from './build/pipeline.bundle.js';
import { AIClient } from './build/aiclient.bundle.js';

const tabMoreBtn = document.getElementById('tab-more');
const tabSettingsBtn = document.getElementById('tab-settings');

const viewMore = document.getElementById('view-more');
const viewSettings = document.getElementById('view-settings');

let calendarBooted = false;
let settingsBooted = false;

let googleAccessToken = null;
let googleTokenExp = 0;

// Global settings (read from Firebase or set by the user)
export const settings = { business_calendar: null }; // <-- global-ish; also attach to window for debugging
window.settings = settings;


// Calendar plumbing
const gcalClient = new GoogleCalendarClient(getGoogleAccessToken);
const calendarStore = new CalendarStore(gcalClient);
setCalendarStore(calendarStore);
window.calendarStore = calendarStore;
window.__AI_CLIENT_INSTANCE = new AIClient();

//capture dialog plumbing
window.openCaptureDialog = () => openCaptureDialog({ calendarStore, settings });
window.openPipelineDrawer = (onOptyClose) => openPipelineDrawer({ calendarStore, onOptyClose });
window.closePipelineDrawer = closePipelineDrawer;


/* ---------------- Opty anchoring API (used by OptyDetailsDrawer) ---------------- */
export let current_opty = null;

/** Set the current opportunity record kept by the host panel (optional state) */
function setCurrentOpty(opty) {
  current_opty = opty || null;
}

/**
 * Anchor the Calendar to the given opportunity.
 * - Ensures Calendar tab is visible
 * - Boots Calendar if needed
 * - Forwards to CalendarUI.setAnchor({ optyId, meta, focusDate })
 */
async function anchorCalendarToOpty(opty, focusDate = null) {
  try {
    setCurrentOpty(opty);
    // Switch to Calendar tab (“more”)
    switchTab('calendar');
    // Ensure calendar is mounted
    maybeBootCalendar(true);
    // Defer to next tick so calendar has a moment to mount if it’s the first time
    setTimeout(() => {
      try {
        const optyId = String(opty?.opty_id ?? opty?.id ?? '');
        if (optyId) {
          window.CalendarUI?.setAnchor?.({ optyId, meta: opty, focusDate });
        }
      } catch {}
    }, 0);
  } catch {}
}

// Expose on window so other modules (drawers, etc.) can call it
window.panel = Object.assign(window.panel || {}, {
  anchorCalendarToOpty,
  setCurrentOpty
});

async function getGoogleAccessToken(force = false) {
  const now = Date.now();
  if (!force && googleAccessToken && now < googleTokenExp - 30_000) return googleAccessToken;

  const msgType = force ? 'google/reauth' : 'google/token';
  const res = await chrome.runtime.sendMessage({ type: msgType }).catch(() => null);
  if (!res?.ok) {
    // small backoff
    await new Promise(r => setTimeout(r, 800));
    throw new Error(res?.error || 'No Google token');
  }
  googleAccessToken = res.access_token;
  googleTokenExp = res.expires_at || (now + 50 * 60 * 1000);
  return googleAccessToken;
}


/* ---------------- Tabs ---------------- */
function activateTab(which) {
  const isCalendar = which === 'calendar';
  const isSettings = which === 'settings';

  tabMoreBtn.classList.toggle('active', isCalendar);
  tabSettingsBtn.classList.toggle('active', isSettings);
  viewMore.classList.toggle('active', isCalendar);
  viewSettings.classList.toggle('active', isSettings);

  if (isCalendar) {
    maybeBootCalendar(true);
  } else {
    try { window.CalendarUI?.clearAnchor?.(); } catch {}
  }
  if (isSettings) {
    maybeBootSettings(true);
  }
}

// NEW: async switchTab that enforces the calendar requirement
async function switchTab(target) {
  if (target === 'calendar') {
    // If we don't know settings yet, try to fetch them
    if (settings.business_calendar == null) {
      try { await loadSettingsFromFirebase(); } catch {}
    }

    // Still missing? Force Settings instead.
    if (!settings.business_calendar) {
      activateTab('settings');
      return;
    }
  }
  activateTab(target);
}
window.switchTab = switchTab;


/* ---------------- Calendar & Pipeline boot ---------------- */
function maybeBootCalendar(shouldBootNow = true) {
  if (calendarBooted || !shouldBootNow) return;
  initCalendar('#calendar-root');
  calendarBooted = true;
}

function maybeBootSettings(shouldBootNow = true) {
  if (settingsBooted || !shouldBootNow) return;
  initSettings('#settings-root'); // mount the MUI app
  settingsBooted = true;
}

/* ---------------- Firebase: read/write settings ---------------- */
// Firestore document path we’ll use: users/{uid}/settings/app
async function loadSettingsFromFirebase() {
  const res = await chrome.runtime.sendMessage({ type: 'settings/get' });
  if (!res?.ok) throw new Error(res?.error || 'settings/get failed');
  const s = res.data || {};
  settings.business_calendar = s.business_calendar || null;
}

async function saveSettingsToFirebase(s) {
  const res = await chrome.runtime.sendMessage({ type: 'settings/set', data: s });
  if (!res?.ok) throw new Error(res?.error || 'settings/set failed');
}

/* ---------------- App init ---------------- */
/* ---------------- App init ---------------- */
(async function init() {
  const splash = document.getElementById('splash');
  try {
    // Load settings first
    try { await loadSettingsFromFirebase(); } catch {}

    // Route based on presence of business_calendar
    if (settings.business_calendar) {
      await switchTab('calendar');
      try { await calendarStore.connect(); } catch (e) { console.error(e); }
    } else {
      await switchTab('settings');
    }

    // Optional: refresh settings quietly later
    try { await loadSettingsFromFirebase(); } catch {}

  } finally {
    if (splash) splash.style.display = 'none';
  }
})();

