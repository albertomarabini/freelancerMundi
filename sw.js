// sw.js
const FB = {
  apiKey: "AIzaSyASTssQTePPShufRsoHSej-c7rdd6qpf6U",
  projectId: "test-chat-extension",
};
const GOOGLE_WEB_CLIENT_ID = "752687402495-metd70oq6vscuhheau36fm1d8pus332v.apps.googleusercontent.com";
const REM_KEY = 'REM_V1';
const POP_URL = chrome.runtime.getURL('reminders.html');
const GRACE_MS = 20 * 60 * 1000;
const HEARTBEAT_MIN = 0.5;
/* ===== Runtime state ===== */
let popupWindowId = null;

/* ===== Storage helpers ===== */
async function readRemState() {
  try {
    const { [REM_KEY]: v } = await chrome.storage.local.get(REM_KEY);
    return v || { items: {}, lastCloseAt: 0, graceUntil: 0 };
  } catch {
    return { items: {}, lastCloseAt: 0, graceUntil: 0 };
  }
}
async function writeRemState(state) {
  try { await chrome.storage.local.set({ [REM_KEY]: state }); } catch {}
}

/* ===== Time/helpers ===== */
function nowMs() { return Date.now(); }
function values(obj) { return Object.values(obj || {}); }

function computeDue(items, t = nowMs()) {
  return values(items).filter(it => !it.checked && typeof it.when === 'number' && t >= it.when);
}
function computeNewlyDueSince(items, since, t = nowMs()) {
  return values(items).filter(it =>
    !it.checked &&
    typeof it.when === 'number' &&
    t >= it.when &&
    it.when >= (since || 0)
  );
}
function computePendingBadgeCount(items, t = nowMs()) {
  // Pending = unchecked and due now (ignoring grace)
  return computeDue(items, t).length;
}

/* ===== Popup management ===== */
async function ensurePopupOpen() {
  // If already open, focus it
  if (popupWindowId != null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      return;
    } catch {
      popupWindowId = null;
    }
  }
  // Create a small popup window
  const w = await chrome.windows.create({
    url: POP_URL,
    type: 'popup',
    width: 380,
    height: 480,
    focused: true
  });
  popupWindowId = w && w.id != null ? w.id : null;
}

async function closePopup() {
  if (popupWindowId == null) return;
  try { await chrome.windows.remove(popupWindowId); } catch {}
  popupWindowId = null;
}

/* When user manually closes the popup (via [x]) */
chrome.windows.onRemoved.addListener((winId) => {
  if (winId === popupWindowId) {
    popupWindowId = null;
    onPopupClosedApplyGrace().catch(() => {});
  }
});

/* ===== Core tick ===== */
async function reminderTick() {
  const t = nowMs();
  const state = await readRemState();

  // Badge
  const badge = computePendingBadgeCount(state.items, t);
  await chrome.action.setBadgeText({ text: badge ? String(badge) : '' });

  // Nothing due, nothing to show
  const due = computeDue(state.items, t);
  if (due.length === 0) return;

  // Within grace?
  const inGrace = state.graceUntil && t < state.graceUntil;
  if (!inGrace) {
    await ensurePopupOpen();
    chrome.runtime.sendMessage({ type: 'rem/pushItems' }).catch(() => {});
    return;
  }

  // During grace: re-open only if new items became due since last close
  const newlyDue = computeNewlyDueSince(state.items, state.lastCloseAt, t);
  if (newlyDue.length > 0) {
    state.lastCloseAt = t;
    state.graceUntil = 0;
    await writeRemState(state);
    await ensurePopupOpen();
    chrome.runtime.sendMessage({ type: 'rem/pushItems' }).catch(() => {});
    return;
  }

  // Still in grace with no new items → schedule wake at grace end so we re-check
  scheduleGraceWake(state.graceUntil);
}

/* ===== Grace handling ===== */
async function onPopupClosedApplyGrace() {
  const t = nowMs();
  const state = await readRemState();
  const due = computeDue(state.items, t);
  if (due.length === 0) return; // no need to grace if nothing due

  state.lastCloseAt = t;
  state.graceUntil = t + GRACE_MS;
  await writeRemState(state);

  // Keep badge reflecting current due items (even during grace)
  const badge = computePendingBadgeCount(state.items, t);
  await chrome.action.setBadgeText({ text: badge ? String(badge) : '' });

  scheduleGraceWake(state.graceUntil);
}

function scheduleGraceWake(whenMs) {
  if (!whenMs) return;
  // Name is deterministic so newest schedule overwrites previous
  chrome.alarms.create('remGrace', { when: whenMs });
}

/* ===== Wiring (wake the SW) ===== */

// One-time init and recurring heartbeat
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.action.setBadgeBackgroundColor({ color: '#666' });
  await chrome.action.setBadgeText({ text: '' });

  // Heartbeat for periodic re-eval of due items & badge
  chrome.alarms.create('remTick', { periodInMinutes: HEARTBEAT_MIN });

  // First evaluation after install
  reminderTick().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  // On browser startup, run a tick right away
  reminderTick().catch(() => {});
});

// React immediately when reminders state changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[REM_KEY]) {
    reminderTick().catch(() => {});
  }
});

// Single onAlarm handler
chrome.alarms.onAlarm.addListener((a) => {
  if (a && (a.name === 'remTick' || a.name === 'remGrace')) {
    reminderTick().catch(() => {});
  }
});

/* ===== Optional: messages from UI (close/open/etc.) ===== */
// Example: from reminders.html → chrome.runtime.sendMessage({ type: 'rem/close' })
chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'rem/close') { closePopup(); }
  if (msg.type === 'rem/open')  { ensurePopupOpen(); }
});

/* ---------- public API for the popup UI & other modules ----------

  Messages:
    - rem/list                 → returns { items: Array<...>, dueNow: string[] }
    - rem/addMany { items }    → add/update many reminders
    - rem/check { ids }        → mark items as checked (read)
    - rem/close                → user closed popup → apply grace
    - rem/focusPopup           → ensure popup is open/focused
    - rem/clearAll             → (debug) clears reminders
------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    /* ====== AUTH & EXISTING ROUTES (kept) ====== */
    if (msg.type === "fs/init") {
      const a = await withAuthRetry(async () => await ensureAuth());
      sendResponse({ ok: true, uid: a.uid, email: a.email, name: a.name });
      return true;
    }
    if (msg.type === "job/add") {
      await withAuthRetry(async (a) => { await fsAddJob(a.firebase_idToken, a.uid, msg.job); });
      sendResponse({ ok: true }); return true;
    }
    if (msg.type === "job/deleteByOptyId") {
      await withAuthRetry(async (a) => { await fsDeleteJobByOptyId(a.firebase_idToken, a.uid, String(msg.opty_id)); });
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'job/updateByOptyId') {
      await withAuthRetry(async (a) => { await fsUpdateJobByOptyId(a.firebase_idToken, a.uid, String(msg.opty_id), msg.patch); });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "jobs/list") {
      const data = await withAuthRetry(async (a) => await fsListJobs(a.firebase_idToken, a.uid, msg.limit || 200));
      sendResponse({ ok: true, data }); return true;
    }
    if (msg.type === "job/byOptyId") {
      const data = await withAuthRetry(async (a) => await fsFindJobByOptyId(a.firebase_idToken, a.uid, msg.opty_id));
      sendResponse({ ok: true, data }); return true;
    }
    if (msg.type === "settings/get") {
      const data = await withAuthRetry(async (a) => await fsGetSettings(a.firebase_idToken, a.uid));
      sendResponse({ ok: true, data }); return true;
    }
    if (msg.type === "settings/set") {
      await withAuthRetry(async (a) => { await fsSetSettings(a.firebase_idToken, a.uid, msg.data || {}); });
      sendResponse({ ok: true }); return true;
    }
    if (msg.type === "fs/load") {
      const data = await withAuthRetry(async (a) => await fsListMessages(a.firebase_idToken, a.uid, msg.chatId, msg.limit));
      sendResponse({ ok: true, data }); return true;
    }
    if (msg.type === "fs/add") {
      await withAuthRetry(async (a) => { await fsAddMessage(a.firebase_idToken, a.uid, msg.chatId, msg.role, msg.content, msg.ts); });
      sendResponse({ ok: true }); return true;
    }
    if (msg.type === "fs/clear") {
      const { deleted } = await withAuthRetry(async (a) => {
        const names = await fsListMessageDocNames(a.firebase_idToken, a.uid, msg.chatId);
        const count = names.length ? await fsBatchDelete(a.firebase_idToken, names) : 0;
        return { deleted: count };
      });
      sendResponse({ ok: true, deleted }); return true;
    }
    if (msg.type === "google/token") {
      const a = await ensureAuth();
      sendResponse({ ok: true, access_token: a.google_accessToken, expires_at: a.google_accessExpiry });
      return true;
    }
    if (msg.type === 'google/reauth') {
      const g = await googleOAuthForceConsent();
      const f = await firebaseSignInWithGoogleIdToken(g.id_token);
      authCache = {
        uid: f.uid, email: f.email, name: f.name,
        firebase_idToken: f.firebase_idToken,
        google_accessToken: g.access_token || null,
        google_accessExpiry: g.access_expiry || 0,
        firebase_refreshToken: f.refreshToken || null
      };
      await writeAuthToStorage(authCache);
      sendResponse({ ok: true, access_token: authCache.google_accessToken, expires_at: authCache.google_accessExpiry });
      return true;
    }

    /* ====== REMINDER ROUTES ====== */
    if (msg.type === 'rem/addMany') {
      // items: Array<{ id, title, when:number(ms), meta? }>
      const state = await readRemState();
      const arr = Array.isArray(msg.items) ? msg.items : [];
      for (const r of arr) {
        if (!r || r.id == null || typeof r.when !== 'number') continue;
        const id = String(r.id);
        const prev = state.items[id] || {};
        state.items[id] = {
          id,
          title: r.title || prev.title || '(reminder)',
          when: r.when,
          meta: r.meta || prev.meta || null,
          checked: !!prev.checked && prev.when === r.when ? true : false, // if same instance remains checked
          createdAt: prev.createdAt || nowMs()
        };
      }
      await writeRemState(state);
      // After adding, check if something is due and maybe open the popup
      await reminderTick();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'rem/list') {
      const state = await readRemState();
      const t = nowMs();
      const items = values(state.items).sort((a,b)=> (a.when - b.when) || (a.id > b.id ? 1 : -1));
      const dueNow = computeDue(state.items, t).map(it => it.id);
      sendResponse({ ok: true, items, dueNow, graceUntil: state.graceUntil || 0, lastCloseAt: state.lastCloseAt || 0 });
      return true;
    }

    if (msg.type === 'rem/check') {
      // ids: string[]
      const ids = Array.isArray(msg.ids) ? msg.ids.map(String) : [];
      const state = await readRemState();
      for (const id of ids) {
        if (state.items[id]) state.items[id].checked = true;
      }
      await writeRemState(state);
      await reminderTick(); // update badge & possibly close popup if nothing due
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'rem/close') {
      // User clicked the popup close button — apply grace
      await onPopupClosedApplyGrace();
      await closePopup();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'rem/focusPopup') {
      await ensurePopupOpen();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'rem/clearAll') {
      await writeRemState({ items: {}, lastCloseAt: 0, graceUntil: 0 });
      await reminderTick();
      sendResponse({ ok: true });
      return true;
    }

  })().catch(e => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});

/* =========================================================================================
   EXISTING AUTH / FIREBASE / HELPERS (unchanged below this line, minus the initial badge demo)
========================================================================================= */

async function googleOAuth(
  scopes = ["openid","email","profile","https://www.googleapis.com/auth/calendar"]
) {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const nonce = crypto.getRandomValues(new Uint32Array(4)).join('-');

  const makeUrl = (prompt) => {
    const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    u.searchParams.set('client_id', GOOGLE_WEB_CLIENT_ID);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'id_token token');
    u.searchParams.set('scope', scopes.join(' '));
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('include_granted_scopes', 'true');
    if (prompt) u.searchParams.set('prompt', prompt);
    return u.toString();
  };

  // 1) silent
  let responseUrl = await chrome.identity
    .launchWebAuthFlow({ url: makeUrl('none'), interactive: false })
    .catch(() => null);

  // 2) interactive fallback
  if (!responseUrl) {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: makeUrl('select_account'),
      interactive: true
    });
  }

  const params = new URLSearchParams(new URL(responseUrl).hash.substring(1));
  const id_token = params.get('id_token');
  const access_token = params.get('access_token');
  const expires_in = Number(params.get('expires_in') || '0');
  if (!id_token) throw new Error('No id_token returned');

  return {
    id_token,
    access_token,
    access_expiry: Date.now() + Math.max(0, (expires_in - 60)) * 1000
  };
}

async function firebaseSignInWithGoogleIdToken(id_token) {
  const requestUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FB.apiKey}`;
  const body = {
    postBody: `id_token=${encodeURIComponent(id_token)}&providerId=google.com`,
    requestUri,
    returnSecureToken: true,
    returnIdpCredential: true
  };
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let reason = `HTTP ${res.status}`; try { const e = await res.json(); reason = e?.error?.message || JSON.stringify(e); } catch {}
    throw new Error(reason);
  }
  const j = await res.json();
  return { firebase_idToken: j.idToken, uid: j.localId, email: j.email || null, name: j.displayName || null, refreshToken: j.refreshToken || null  };
}

// Google → Firebase sign-in for Chrome Extension
async function getGoogleIdTokenViaWebAuthFlow() {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const nonce = crypto.getRandomValues(new Uint32Array(4)).join('-');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_WEB_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'id_token'); // id_token is the key for Firebase
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('prompt', 'select_account');

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true
  });

  // Parse fragment: #id_token=...&...
  const frag = new URL(responseUrl).hash.substring(1);
  const params = new URLSearchParams(frag);
  const idToken = params.get('id_token');
  if (!idToken) throw new Error('No id_token returned');
  return idToken;
}

async function googleOAuthForceConsent(scopes = ["openid","email","profile","https://www.googleapis.com/auth/calendar"]) {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const nonce = crypto.getRandomValues(new Uint32Array(4)).join('-');
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', GOOGLE_WEB_CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'id_token token');
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('nonce', nonce);
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('prompt', 'consent'); // <-- force new grant
  const responseUrl = await chrome.identity.launchWebAuthFlow({ url: u.toString(), interactive: true });
  const params = new URLSearchParams(new URL(responseUrl).hash.substring(1));
  return {
    id_token: params.get('id_token'),
    access_token: params.get('access_token'),
    access_expiry: Date.now() + Math.max(0, (Number(params.get('expires_in')||'0') - 60))*1000
  };
}

async function signInWithGoogle() {
  const idToken = await getGoogleIdTokenViaWebAuthFlow();

  // Exchange with Firebase using the ID token (not access token)
  const requestUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FB.apiKey}`;
  const body = {
    postBody: `id_token=${encodeURIComponent(idToken)}&providerId=google.com`,
    requestUri,
    returnSecureToken: true,
    returnIdpCredential: true
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let reason = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      reason = err?.error?.message || JSON.stringify(err);
      console.warn('Firebase signInWithIdp failed:', JSON.stringify(err, null, 2));
    } catch {}
    throw new Error(reason);
  }

  const j = await res.json();
  return { idToken: j.idToken, uid: j.localId, email: j.email || null, name: j.displayName || null };
}

let _ensureAuthTask = null; // to prevent concurrent calls
let authCache = null; // { uid, email, name, firebase_idToken, google_accessToken, google_accessExpiry }
const AUTH_KEY = 'authCache_v1';

async function readAuthFromStorage(){ try { const { [AUTH_KEY]: v } = await chrome.storage.local.get(AUTH_KEY); return v || null; } catch { return null; } }
async function writeAuthToStorage(a){ try { await chrome.storage.local.set({ [AUTH_KEY]: a }); } catch {} }
async function clearAuthInStorage(){ try { await chrome.storage.local.remove(AUTH_KEY); } catch {} }
async function ensureAuth() {
  if (_ensureAuthTask) return _ensureAuthTask;
  _ensureAuthTask = (async () => {
    if (authCache && authCache.firebase_idToken && authCache.google_accessToken && Date.now() < (authCache.google_accessExpiry || 0)) {
      return authCache;
    }
    const cached = await readAuthFromStorage();
    if (cached && cached.firebase_idToken && cached.google_accessToken && Date.now() < (cached.google_accessExpiry || 0)) {
      authCache = cached; return authCache;
    }
    const g = await googleOAuth();
    const f = await firebaseSignInWithGoogleIdToken(g.id_token);
    authCache = {
      uid: f.uid,
      email: f.email,
      name: f.name,
      firebase_idToken: f.firebase_idToken,
      google_accessToken: g.access_token || null,
      google_accessExpiry: g.access_expiry || 0,
      firebase_refreshToken: f.refreshToken || null
    };
    await writeAuthToStorage(authCache);
    return authCache;
  })();
  try { return await _ensureAuthTask; }
  finally { _ensureAuthTask = null; }
}

function isAuthStatus(err) {
  const s = err && (err.status || err.code);
  if (s === 401 || s === 403) return true;
  const msg = String(err?.message || err || '');
  return /401|403|UNAUTH|PERMISSION/i.test(msg);
}
async function refreshAuthWithConsent() {
  const g = await googleOAuthForceConsent(); // uses prompt=consent
  const f = await firebaseSignInWithGoogleIdToken(g.id_token);
  authCache = {
    uid: f.uid, email: f.email, name: f.name,
    firebase_idToken: f.firebase_idToken,
    google_accessToken: g.access_token || null,
    google_accessExpiry: g.access_expiry || 0,
    firebase_refreshToken: f.refreshToken || null
  };
  await writeAuthToStorage(authCache);
  return authCache;
}
async function withAuthRetry(op) {
  let a = await ensureAuth();
  try { return await op(a); }
  catch (e1) {
    if (!isAuthStatus(e1)) throw e1;
    a = await refreshAuthWithConsent();
    try { return await op(a); }
    catch (e2) { throw e2; }
  }
}
function create_Error_with_status(res, message) {
  const err = new Error(message);
  err.status = res.status;
  ;
  console.warn(`${message}: HTTP ${res.status} ${res.statusText} ${res.data ? JSON.stringify(res.data) : ''}`);
  return err;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // (The additional listener above already handles everything; we keep this no-op to avoid removing your structure)
  return true;
});

/* ---------- Firestore helpers (unchanged) ---------- */
// Get full document names for all messages in a chat
async function fsListMessageDocNames(idToken, uid, chatId) {
  const url = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents:runQuery`;
  const body = { structuredQuery: { from: [{ collectionId: "messages" }], select: { fields: [{ fieldPath: "__name__" }] } } };
  const parent = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}/chats/${chatId}`;
  const res = await fetch(`${url}?parent=${encodeURIComponent(parent)}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
  if (!res.ok) throw create_Error_with_status(res, "list names failed");
  const rows = await res.json();
  return rows.filter(r => r.document?.name).map(r => r.document.name);
}
// Batch delete
async function fsBatchDelete(idToken, docNames) {
  const url = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents:batchWrite`;
  const CHUNK = 400;
  let deleted = 0;
  for (let i = 0; i < docNames.length; i += CHUNK) {
    const slice = docNames.slice(i, i + CHUNK);
    const body = { writes: slice.map(name => ({ delete: name })) };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
    if (!res.ok) throw create_Error_with_status(res, "batch delete failed");
    deleted += slice.length;
  }
  return deleted;
}
async function fsGetSettings(idToken, uid) {
  const name = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}/settings/app`;
  const url  = `https://firestore.googleapis.com/v1/${name}`;
  const res = await fetch(url, { headers: { "Authorization": `Bearer ${idToken}` } });
  if (res.status === 404) return {};
  if (!res.ok) throw new Error('settings read failed');
  const doc = await res.json();
  const f = doc.fields || {};
  return { business_calendar: f.business_calendar?.stringValue || null };
}
async function fsSetSettings(idToken, uid, partial) {
  const name = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}/settings/app`;
  const url  = `https://firestore.googleapis.com/v1/${name}?currentDocument.exists=true`;
  const fields = {};
  if (partial.business_calendar !== undefined) {
    const v = partial.business_calendar;
    fields.business_calendar = v == null ? { nullValue: null } : { stringValue: String(v) };
  }
  const patchRes = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body: JSON.stringify({ fields })
  });
  if (patchRes.ok) return;
  const parent = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}/settings`;
  const createUrl = `https://firestore.googleapis.com/v1/${parent}?documentId=app`;
  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}` },
    body: JSON.stringify({ fields })
  });
  if (!createRes.ok) throw new Error('settings write failed');
}
async function fsListMessages(idToken, uid, chatId, limit = 50) {
  const url = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "messages" }],
      where: { fieldFilter: { field: { fieldPath: "ts" }, op: "GREATER_THAN", value: { integerValue: "0" } } },
      orderBy: [{ field: { fieldPath: "ts" }, direction: "ASCENDING" }],
      limit
    }
  };
  const parent = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}/chats/${chatId}`;
  const res = await fetch(`${url}?parent=${encodeURIComponent(parent)}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` }, body: JSON.stringify(body) });
  if (!res.ok) throw create_Error_with_status(res, "read failed");
  const rows = await res.json();
  return rows
    .filter(r => r.document)
    .map(r => {
      const f = r.document.fields || {};
      return { role: f.role?.stringValue || "assistant", content: f.content?.stringValue || "", ts: Number(f.ts?.integerValue || "0") };
    });
}

async function fsListJobs(idToken, uid, limit = 200) {
  // Helper: normalize contacts from Firestore fields
  function decodeContacts(fields) {
    const av = fields?.contacts?.arrayValue?.values;
    if (Array.isArray(av)) {
      return av.map((v) => {
        const cf = v?.mapValue?.fields || {};
        return {
          name:   (cf.name?.stringValue  || '').trim(),
          role:   (cf.role?.stringValue  || '').trim(),
          email:  (cf.email?.stringValue || '').trim(),
          phone:  (cf.phone?.stringValue || '').trim(),
          source: (cf.source?.stringValue || 'page'),
        };
      });
    }
    // Legacy fallback: contacts_json (to be migrated away)
    const cj = fields?.contacts_json?.stringValue || null;
    if (cj) {
      try {
        const arr = JSON.parse(cj);
        if (Array.isArray(arr)) {
          return arr.map((c) => ({
            name:   (c?.name  || '').trim(),
            role:   (c?.role  || '').trim(),
            email:  (c?.email || '').trim(),
            phone:  (c?.phone || '').trim(),
            source: 'page',
          }));
        }
      } catch {}
    }
    return [];
  }

  const url   = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents:runQuery`;
  const body  = { structuredQuery: { from: [{ collectionId: "jobs" }], limit } };
  const parent = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}`;

  const res = await fetch(`${url}?parent=${encodeURIComponent(parent)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw create_Error_with_status(res, "jobs read failed");

  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const f = r.document.fields || {};
      function s(k) { return f[k]?.stringValue || null; }
      function a(k) { return (f[k]?.arrayValue?.values || []).map((v) => v.stringValue || ""); }
      function j(k) { try { return JSON.parse(s(k) || "null"); } catch (_) { return null; } }

      return {
        id: r.document.name.split("/").pop() || undefined,
        title: s("title"),
        company: s("company"),
        location: s("location"),
        platform: s("platform"),
        external_id: s("external_id"),
        url: s("url"),
        post_date: s("post_date"),
        saved_at: s("saved_at"),
        opty_id: s("opty_id"),
        skills: a("skills"),
        deliverables: a("deliverables"),
        compensation_fixed: s("budget_text"),
        compensation_hourly: s("rate_text"),
        contacts: decodeContacts(f),                 // <- structured first; legacy fallback
        deadlines: j("deadlines_norm_json"),
        funnel_stage: s("funnel_stage"),
        proposal_status: s("proposal_status"),
        budget: s("budget"),
        rate: s("rate"),
        bid_amnt: s("bid_amnt"),
        awarded_amnt: s("awarded_amnt"),
        comp_text: s("comp_text"),
        comp_type: s("comp_type"),
      };
    });
}


async function fsAddJob(idToken, uid, job) {

  const putContacts = (k, arr) => {
    if (!Array.isArray(arr)) return;
    if (!arr.length) { fields[k] = { arrayValue: {} }; return; }
    fields[k] = {
      arrayValue: {
        values: arr.map(c => ({
          mapValue: {
            fields: {
              name:   { stringValue: String(c?.name  || '') },
              role:   { stringValue: String(c?.role  || '') },
              email:  { stringValue: String(c?.email || '') },
              phone:  { stringValue: String(c?.phone || '') },
              source: { stringValue: String(c?.source || 'page') }
            }
          }
        }))
      }
    };
  };

  const url = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents/users/${uid}/jobs`;
  const fields = {};
  const putS = (k, v) => { if (v != null) fields[k] = { stringValue: String(v) }; };
  const putA = (k, arr) => {
    if (!Array.isArray(arr)) return;
    fields[k] = { arrayValue: { values: arr.map(x => ({ stringValue: String(x) })) } };
  };
  putS('url', job.url);
  putS('platform', job.platform);
  putS('external_id', job.external_id);
  putS('title', job.title);
  putS('company', job.company);
  putS('location', job.location);
  putS('description_summary', job.description_summary);
  putA('skills', job.skills);
  putS('budget', job.budget);
  putS('rate', job.rate);
  putS('post_date', job.post_date);
  putS('proposal_status', job.proposal_status || 'new');
  putS('submission_url', job.submission_url);
  putS('status_url', job.status_url);
  putS('notifications_enabled', job.notifications_enabled ? 'true' : 'false');
  putS('notes', job.notes);
  putS('bid_amnt', job.bid_amnt);
  putS('awarded_amnt', job.awarded_amnt);
  putS('funnel_stage', job.funnel_stage || 'examining');
  putA('deliverables', job.deliverables);
  putContacts('contacts', job.contacts);
  putS('comp_type', job.comp_type);
  putS('comp_text', job.comp_text);
  putS('opty_id', job.opty_id);
  putS('saved_at', job.saved_at);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields })
  });
  if (!res.ok) throw create_Error_with_status(res, "job write failed");
}

async function fsUpdateJobByOptyId(idToken, uid, optyId, patch) {

  // helper: array<Contact> -> arrayValue of mapValue
  const putContacts = (k, arr) => {
    if (!Array.isArray(arr)) return;
    if (!arr.length) {
      // allow clearing all contacts
      fields[k] = { arrayValue: {} };
      return;
    }
    fields[k] = {
      arrayValue: {
        values: arr.map((c) => ({
          mapValue: {
            fields: {
              name:   { stringValue: String(c?.name  || '') },
              role:   { stringValue: String(c?.role  || '') },
              email:  { stringValue: String(c?.email || '') },
              phone:  { stringValue: String(c?.phone || '') },
              source: { stringValue: String(c?.source || 'page') }
            }
          }
        }))
      }
    };
  };
  // 1) find the document by opty_id
  const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents:runQuery`;
  const parent = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "jobs" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "opty_id" },
          op: "EQUAL",
          value: { stringValue: String(optyId) }
        }
      },
      limit: 1
    }
  };
  const STAGES = ["examining", "applied", "submitted", "awarded", "paid"];

  const qRes = await fetch(`${runQueryUrl}?parent=${encodeURIComponent(parent)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body)
  });

  if (!qRes.ok) throw create_Error_with_status(qRes, 'query opty_id failed');
  const rows = await qRes.json();
  const docName = rows && rows[0] && rows[0].document && rows[0].document.name;
  if (!docName) throw new Error('No document for given opty_id');

  // 2) build Firestore PATCH
  const fields = {};
  const putS = (k, v) => { if (v != null) fields[k] = { stringValue: String(v) }; };
  const putA = (k, arr) => {
    if (!Array.isArray(arr)) return;
    fields[k] = { arrayValue: { values: arr.map(x => ({ stringValue: String(x) })) } };
  };

  // Only map keys we allow to be edited from the drawer
  if ('title' in patch) putS('title', patch.title);
  if ('company' in patch) putS('company', patch.company);
  if ('location' in patch) putS('location', patch.location);
  if ('description_summary' in patch) putS('description_summary', patch.description_summary);
  if ('comp_type' in patch) putS('comp_type', patch.comp_type);
  if ('comp_text' in patch) putS('comp_text', patch.comp_text);
  if ('skills' in patch) putA('skills', patch.skills);
  if ('deliverables' in patch) putA('deliverables', patch.deliverables);
  if ('notes' in patch) putS('notes', patch.notes);
  if ('contacts' in patch) putContacts('contacts', patch.contacts);
  if ('funnel_stage' in patch) {
    // guard/normalize; fallback to 'examining' if something funky comes in
    const s = String(patch.funnel_stage || '').toLowerCase();
    const norm = STAGES.includes(s) ? s : 'examining';
    putS('funnel_stage', norm);
  }

  // Build update mask from provided props
  const updateMaskPaths = Object.keys(fields);

  if (!updateMaskPaths.length) return; // nothing to update
  // Always delete legacy contacts_json if contacts is being updated
  if ('contacts' in patch && !updateMaskPaths.includes('contacts_json')) {
    updateMaskPaths.push('contacts_json'); // deleting legacy on write
  }
  const params = new URLSearchParams();
  for (const p of updateMaskPaths) params.append("updateMask.fieldPaths", p);
  const patchUrl = `https://firestore.googleapis.com/v1/${docName}?${params.toString()}`;

  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields })
  });
  if (!patchRes.ok) throw create_Error_with_status(patchRes, 'job update failed');
}


async function fsFindJobByOptyId(idToken, uid, optyId) {
  if (!optyId) return null;

  // Helper: normalize contacts from Firestore fields
  function decodeContacts(fields) {
    const av = fields?.contacts?.arrayValue?.values;
    if (Array.isArray(av)) {
      return av.map((v) => {
        const cf = v?.mapValue?.fields || {};
        return {
          name:   (cf.name?.stringValue  || '').trim(),
          role:   (cf.role?.stringValue  || '').trim(),
          email:  (cf.email?.stringValue || '').trim(),
          phone:  (cf.phone?.stringValue || '').trim(),
          source: (cf.source?.stringValue || 'page'),
        };
      });
    }
    // Legacy fallback: contacts_json (to be migrated away)
    const cj = fields?.contacts_json?.stringValue || null;
    if (cj) {
      try {
        const arr = JSON.parse(cj);
        if (Array.isArray(arr)) {
          return arr.map((c) => ({
            name:   (c?.name  || '').trim(),
            role:   (c?.role  || '').trim(),
            email:  (c?.email || '').trim(),
            phone:  (c?.phone || '').trim(),
            source: 'page',
          }));
        }
      } catch {}
    }
    return [];
  }

  const url    = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents:runQuery`;
  const parent = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}`;
  const body   = {
    structuredQuery: {
      from: [{ collectionId: "jobs" }],
      where: { fieldFilter: { field: { fieldPath: "opty_id" }, op: "EQUAL", value: { stringValue: String(optyId) } } },
      limit: 1,
    },
  };

  const res = await fetch(`${url}?parent=${encodeURIComponent(parent)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw create_Error_with_status(res, "jobs findByOptyId failed");

  const rows = await res.json();
  const hit  = rows.find((r) => r.document);
  if (!hit) return null;

  const f = hit.document.fields || {};
  const s = (k) => f[k]?.stringValue || null;
  const a = (k) => (f[k]?.arrayValue?.values || []).map((v) => v.stringValue || "");
  const j = (k) => { try { return JSON.parse(s(k) || "null"); } catch { return null; } };

  return {
    id: hit.document.name.split("/").pop() || undefined,
    url: s("url"),
    platform: s("platform"),
    external_id: s("external_id"),
    title: s("title"),
    company: s("company"),
    location: s("location"),
    description_summary: s("description_summary"),
    skills: a("skills"),
    budget: s("budget"),
    rate: s("rate"),
    post_date: s("post_date"),
    proposal_status: s("proposal_status"),
    submission_url: s("submission_url"),
    status_url: s("status_url"),
    notifications_enabled: s("notifications_enabled") === "true",
    notes: s("notes"),
    bid_amnt: s("bid_amnt"),
    awarded_amnt: s("awarded_amnt"),
    funnel_stage: s("funnel_stage"),
    deliverables: a("deliverables"),
    contacts: decodeContacts(f),                    // <- structured first; legacy fallback
    comp_type: s("comp_type"),
    comp_text: s("comp_text"),
    opty_id: s("opty_id"),
    saved_at: s("saved_at"),
  };
}


async function fsDeleteJobByOptyId(idToken, uid, optyId) {
  // 1) Find the document by opty_id (same pattern as updateByOptyId)
  const runQueryUrl = `https://firestore.googleapis.com/v1/projects/${FB.projectId}/databases/(default)/documents:runQuery`;
  const parent = `projects/${FB.projectId}/databases/(default)/documents/users/${uid}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "jobs" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "opty_id" },
          op: "EQUAL",
          value: { stringValue: String(optyId) }
        }
      },
      limit: 1
    }
  };

  const qRes = await fetch(`${runQueryUrl}?parent=${encodeURIComponent(parent)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(body)
  });
  if (!qRes.ok) throw create_Error_with_status(qRes, 'query opty_id failed');

  const rows = await qRes.json();
  const docName = rows && rows[0] && rows[0].document && rows[0].document.name;
  if (!docName) return; // already gone / nothing to delete

  // 2) Delete the document
  const delRes = await fetch(`https://firestore.googleapis.com/v1/${docName}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` }
  });
  if (!delRes.ok) throw create_Error_with_status(delRes, 'job delete failed');
}
