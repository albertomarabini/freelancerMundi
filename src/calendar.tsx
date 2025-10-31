/* src/calendar.tsx */
declare const chrome: any;
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';

import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import ListItemText from '@mui/material/ListItemText';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import Settings from '@mui/icons-material/Settings';

import EventEditorDialog, { type EventEditorValues } from './components/EventEditorDialog';
import { ThemeProvider } from '@emotion/react';
import { compactTheme } from './theme/compactTheme';
import { IconButton } from '@mui/material';

// OO Google client & shared types
import type {
  CalEvt,
  AdvancedOpts,
  Importance
} from './types/interfaces';
const IMPORTANCE_LABELS = ['other','submission','delivery','milestone','meeting']
// const IMPORTANCE_STYLES = {
//   delivery:   { backgroundColor: '#E53935', outline: '5px solid rgba(229, 57, 53, 1)', border: '0px solid' },      // red
//   submission: { backgroundColor: '#4B5320', outline: '3px solid rgba(75, 83, 32, 0.8)', border: '0px solid' },  // green
//   milestone:  { backgroundColor: '#FFB300', outline: '2px solid rgba(255, 179, 0, 0.5)', border: '0px solid' },    // yellow
//   meeting:    { backgroundColor: '#0288d1', outline: '1px solid rgba(2, 136, 209, 0.2)'},    // light blue
//   other:      { backgroundColor: '#607d8b', outline: '0px solid rgba(96, 125, 139, 0.85)' },  // blue grey
// };
const IMPORTANCE_STYLES = {
  delivery:   { backgroundColor: '#F8B4B4', color: '#1f2937' }, // pastel red
  submission: { backgroundColor: '#D5E8C5', color: '#1f2937' }, // pastel green
  milestone:  { backgroundColor: '#FDE68A', color: '#1f2937' }, // pastel yellow
  meeting:    { backgroundColor: '#BAE6FD', color: '#1f2937' }, // pastel light blue
  other:      { backgroundColor: '#CFD8DC', color: '#1f2937' }, // pastel blue-grey
};


import { STAGE_COLORS, type OpportunityStage } from "./types/interfaces";

// Headless state store
import type {
  CalendarSnapshot,
  ICalendarStore
} from './lib/state/CalendarStore';
import { Retrievers } from './shared/retrievers';
import { openOptyDetailsDrawer } from './shared/OptyDetailsDrawer';
import type { OptyAnchor } from './types/window';

const locales: any = { 'en-US': enUS };
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales });
const DnDCalendar = withDragAndDrop(Calendar as any);

// Color strengths
const COLOR_STRENGTH_OPAQUE = 0.1; // how much to darken busy events
const COLOR_STRENGTH_FREE   = 0.02; // slightly lighter base for "Free"

// ===== Store wiring =====
let tokenProvider: null | (() => Promise<string>) = null;
let snap: CalendarSnapshot | null = null;
let store: ICalendarStore | null = null;
let __evToOptyId: { [eventId: string]: string } = {};
let __optyStage: { [optyId: string]: OpportunityStage } = {};

// ===== View-local mirrors (kept for 1:1 parity with original) =====
let focusedDate = new Date();
let currentEvents: CalEvt[] = [
  {
    title: 'Welcome to your Calendar',
    start: new Date(),
    end: new Date(Date.now() + 60 * 60 * 1000),
  }
];
let lastSelected: any = null;

let gCalendars: Array<{
  id: string; summary: string; primary?: boolean; bg?: string;
  accessRole?: string; selectedFlag?: boolean; group: 'mine' | 'other';
  timeZone?: string;
}> = [];
let selectedIds = new Set<string>();
let __appliedBizDefault = false;
function getBizCalId(): string | null {
  try { return (window as any)?.settings?.business_calendar ?? null; }
  catch { return null; }
}
let currentRange: { timeMinISO: string; timeMaxISO: string } | null = null;


// ----- OPTY ANCHOR (gig anchoring) -----
let __optyAnchor: OptyAnchor = null;

// (window hook so panel.js can call it)
(function exposeCalendarUI(){
  (window as any).CalendarUI = (window as any).CalendarUI || {};
  (window as any).CalendarUI.setAnchor  = function setAnchor(p: { optyId: string; meta?: any; focusDate?: Date | null }) {
    __optyAnchor = p || null;
    if (__optyAnchor?.focusDate) setFocused(__optyAnchor.focusDate);
    renderOptyBanner();
    renderInto('#calendar-root');
    (window as any).closePipelineDrawer?.(); // try close drawer if open
  };
  (window as any).CalendarUI.clearAnchor = function clearAnchor() {
    __optyAnchor = null;
    renderOptyBanner();
    renderInto('#calendar-root');
  };
  (window as any).CalendarUI.getAnchor = function getAnchor():{ optyId: string; meta?: any; focusDate?: Date | null } | null  { return __optyAnchor; };
  (window as any).CalendarUI.openCreate = function openCreate(start?: Date, end?: Date, link?: { optyId: string; meta?: any }) {
    try { openEditorForCreate(start, end, link); } catch {}
  };
  (window as any).CalendarUI.openEdit = function openEdit(ev: any) {
    try { openEditorForEvent(ev); } catch {}
  };
})();



// ----- OPTY BANNER RENDERING -----
let bannerRoot: Root | null = null;

function ensureBannerHost(): HTMLElement {
  const { right } = ensureToolbar();
  let host = document.getElementById('calendar-opty-banner');
  if (!host) {
    host = document.createElement('div');
    host.id = 'calendar-opty-banner';
    right.appendChild(host);
  }
  Object.assign(host.style, {
    flex: '1 1 auto',
    minWidth: 0,
  });
  return host;
}

// invoked after the Opty drawer fully closes
function onDrawerClosedCalendar(): void {
  try {
    if (store && typeof store.refreshEvents === 'function') {
      // if anything changed while the drawer was open (deadlines, etc.)
      store.refreshEvents();
    }
  } catch (_e) { /* silent */ }

  // Make sure the current view redraws (keeps focus/view/range)
  try { renderOptyBanner(); } catch {}
  try { renderInto('#calendar-root'); } catch {}
}

async function reopenOptyDrawerFromBanner() {
  try {
    if (!__optyAnchor?.meta) return;
    const retr = new Retrievers(store!);
    const evts = await retr.fetchEventsByOptyId(String(__optyAnchor.meta.opty_id || __optyAnchor.optyId), undefined) || [];
    openOptyDetailsDrawer(__optyAnchor.meta, evts, onDrawerClosedCalendar);
  } catch { /* silent */ }
}

function renderOptyBanner(): void {
  const host = ensureBannerHost();
  if (!bannerRoot) bannerRoot = createRoot(host);

  if (!__optyAnchor) {
    bannerRoot.render(React.createElement(React.Fragment, null));
    return;
  }
  const meta = __optyAnchor.meta || {};
  const title = meta.title || 'Untitled';
  const company = meta.company || '—';

  // Azure palette
  const AZURE_BG = '#E6F4FF';
  const AZURE_BORDER = '#9CCBFF';
  const AZURE_BORDER_HOVER = '#7fbaff';

  const onOpenDrawer = () => { reopenOptyDrawerFromBanner(); };
  const onClear = (e: any) => { e.stopPropagation(); (window as any).CalendarUI?.clearAnchor?.(); };

  bannerRoot.render(
    React.createElement(ThemeProvider as any, { theme: compactTheme },
      React.createElement(Box as any, {
        onClick: onOpenDrawer,
        sx: {
          width: '97%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          padding: "2px",
          borderRadius: 1.5,
          bgcolor: AZURE_BG,
          border: '2px solid',
          borderColor: AZURE_BORDER,
          transition: 'border-color 120ms ease',
          cursor: 'pointer',
          '&:hover': { borderColor: AZURE_BORDER_HOVER },
        },
      },
        React.createElement(IconButton as any, {
          size: 'small',
          onClick: onClear,
          sx: {
            mr: 0.5,
            padding: '6px',
            color: AZURE_BORDER,
            '&:hover': { color: AZURE_BORDER_HOVER, background: 'transparent' },
          }
        },
          React.createElement(CloseRoundedIcon as any, { sx: { fontSize: '2rem' } })
        ),

        // Text block (fills the right side)
        React.createElement(Box as any, { sx: { display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 } },
          React.createElement(Typography as any, { variant:'body1', sx:{ fontSize: '1.2rem', fontWeight:700 } }, "Gig:"),
          React.createElement(Typography as any, {
            variant: 'body1',
            noWrap: true,
            sx: { fontSize: '1.2rem', fontWeight: 500, minWidth: 0, flex: 1 }
          },
            `${title} · ${company}`
          ),
          meta?.url ? React.createElement(Link as any, {
            href: meta.url, target: '_blank', rel: 'noreferrer',
            onClick: (e: any) => e.stopPropagation(),
            underline: 'hover',
            sx: { whiteSpace: 'nowrap', fontSize: '0.95rem', marginRight: '4px'}
          }, 'Open link') : null
        )
      )
    )
  );
}


// --- MUI Editor root ---
let editorRoot: Root | null = null;
function ensureEditorRoot(): Root {
  let host = document.getElementById('mui-editor-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'mui-editor-root';
    document.body.appendChild(host);
  }
  if (!editorRoot) editorRoot = createRoot(host);
  return editorRoot;
}

function closeEditorPortal() {
  if (!editorRoot) return;
  editorRoot.render(React.createElement(React.Fragment, null));
}

// helper to expose calendars for the dialog
function getWritableCalendars() {
  return gCalendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer');
}

// central renderer
function renderEditor(open: boolean, mode: 'create'|'edit', ev?: CalEvt | null, createLink?: { optyId: string; meta?: any }) {
  const r = ensureEditorRoot();
  const calendars = getWritableCalendars();
  const defaultCalId = (ev?.calendarId) || getActiveCalendarId();

  async function onSave(values: EventEditorValues) {
    const { title, desc, start, end, isAllDay, calendarId, attendees, reminderString,
            recurrenceRRULE, recurrence, addMeet, location, visibility, transparency, importance } = values;

    const tz = getCalTZ(calendarId);
    const remMins = (reminderString ?? '').trim() === '' ? undefined : parseReminderToMinutes(reminderString || '');

    if (mode === 'edit' && ev && ev.id) {
      // keep selection aligned
      if (store && ev.id) (store as any).setLastSelectedById?.(ev.id);

      await updateSelectedEventAdvanced(
        title, desc, start, end, calendarId,
        {
          isAllDay, timeZone: tz,
          recurrenceRRULE,
          recurrence,
          attendeesEmails: attendees,
          reminderMinutes: remMins,
          addMeet, location,
          visibility, transparency,
          importance: (importance || undefined) as any
        }
      );
    } else {
      await createEventAdvanced(
        title, start, end, desc, calendarId,
        {
          isAllDay, timeZone: tz,
          recurrenceRRULE,
          attendeesEmails: attendees,
          reminderMinutes: (remMins === null ? null : remMins) as any,
          addMeet, location,
          visibility, transparency,
          importance: (importance || undefined) as any,
          extendedPrivate: createLink?.optyId ? { opty_id: String(createLink.optyId) } : undefined
        }
      );
    }

    closeEditorPortal();
  }

  async function onDelete(scope: 'this'|'all'|'future') {
    if (!store || !ev?.id) return;
    const calId = ev.calendarId || getActiveCalendarId();
    try {
      if (scope === 'this') await store.deleteThis(calId, ev.id);
      else if (scope === 'all') await store.deleteAll(calId, ev.id);
      else await store.deleteThisAndFuture(calId, ev.id);
    } catch(e:any){ toast('Delete failed: ' + (e?.message || e)); }
    finally { closeEditorPortal(); }
  }

  r.render(
    React.createElement(EventEditorDialog as any, {
      open,
      mode,
      event: ev || null,
      calendars,
      defaultCalendarId: defaultCalId,
      getTimeZone: getCalTZ,
      onSave,
      onDelete: mode === 'edit' ? onDelete : undefined,
      onClose: closeEditorPortal
    })
  );
}





/* ===== React Calendar class (no FCs) ===== */
class CalendarApp extends React.Component<{ events: CalEvt[]; onRangeChange: (range: any) => void }, {}> {
  render() {
    return (
      React.createElement('div', { style: { height: '100%' } },
        React.createElement(DnDCalendar as any, {
          date: focusedDate,
          localizer: localizer,
          events: this.props.events,
          startAccessor: 'start',
          endAccessor: 'end',
          popup: true,
          views: ['month', 'week', 'day', 'agenda'],
          style: { height: 'calc(100% - 1.7rem)' },
          selectable: true,
          onView: rbcOnView,
          onRangeChange: inRange,
          onNavigate: rbcOnNavigate,
          onSelectEvent: rbcOnSelectEvent,
          onDoubleClickEvent: rbcOnDoubleClickEvent,
          onSelectSlot: rbcOnSelectSlot,
          onEventDrop: handleEventDrop,
          draggableAccessor: rbcDraggableAccessor,
          onEventResize: handleEventResize,
          resizable: true,
          eventPropGetter: rbcEventPropGetter,
          getDrilldownView: (date: Date, view: string) => {
            if (view === 'month') return 'week';
            return 'day';
          }
          // onDrillDown: rbcOnDrillDown,
        })
      )
    );
  }
}

/* ===== Top-level RBC handlers (no arrow funcs) ===== */
let currentView: 'month' | 'week' | 'day' | 'agenda' = 'month';
function rbcOnNavigate(d: Date, _view: any) {
  setFocused(d);
}
function rbcOnView(_v: any) {
  currentView = _v;
  renderInto('#calendar-root');
}
function rbcOnSelectEvent(ev: any) {
  selectEvent(ev);
  setFocused(ev.start);
  openInfoPopup(ev);
}
function rbcOnDoubleClickEvent(ev: any) {
  selectEvent(ev);
  openInfoPopup(ev);
}
function rbcOnSelectSlot(info: any) {
  handleSlotSelect(info);
}
function rbcDraggableAccessor(): boolean {
  return true;
}

function extractOptyIdFromEvent(ev: any): string | null {
  try {
    var ext = ev && ev.extended ? ev.extended : null;
    var pri = ext && ext.private ? ext.private : null;
    var shd = ext && ext.shared ? ext.shared : null;
    var id = (pri && pri.opty_id) || (shd && shd.opty_id) || null;
    if (id == null && store && ev && ev.id) {
      // if needed later we can sync-fetch raw, but we keep this POC headless for speed
    }
    return id ? String(id) : null;
  } catch (_e) { return null; }
}

function normalizeStage(s: any): OpportunityStage | null {
  if (!s) return null;
  var v = String(s).toLowerCase();
  return (v === "examining" || v === "applied" || v === "submitted" || v === "awarded" || v === "paid")
    ? (v as OpportunityStage)
    : null;
}

/** Rebuild caches for the *current* event list and fetch all unique opty stages. */
function refreshOptyStageCache(): void {
  // reset per-render caches
  __evToOptyId = {};
  __optyStage = {};

  // collect visible event → optyId
  var uniq: { [optyId: string]: true } = {};
  for (var i = 0; i < currentEvents.length; i++) {
    var ev = currentEvents[i] as any;
    var evId = ev && ev.id ? String(ev.id) : null;
    if (!evId) continue;
    var oid = extractOptyIdFromEvent(ev);
    if (!oid) continue;
    __evToOptyId[evId] = oid;
    uniq[oid] = true;
  }

  // fetch each unique opty
  var ids = Object.keys(uniq);
  if (!ids.length) return;

  var promises: Array<Promise<void>> = [];
  for (var j = 0; j < ids.length; j++) {
    (function (optyId: string) {
      var p = chrome.runtime
        .sendMessage({ type: "job/byOptyId", opty_id: String(optyId) })
        .then(function (res: any) {
          if (!res || !res.ok) return;
          var opty = res.data || null;
          var st = normalizeStage(opty && opty.funnel_stage);
          if (st) __optyStage[optyId] = st;
        })
        .catch(function (_e: any) { /* silent */ });
      promises.push(p as any);
    })(ids[j]);
  }

  // after all are in, re-render to apply stage colors
  Promise.all(promises).then(function () {
    try { renderInto('#calendar-root'); } catch (_e) {}
  });
}

/** Sync lookup used by the painter. */
function getStageForEvent(ev: any): OpportunityStage | null {
  var evId = ev && ev.id ? String(ev.id) : null;
  if (!evId) return null;
  var oid = __evToOptyId[evId];
  if (!oid) return null;
  var st = __optyStage[oid];
  return st || null;
}


function rbcEventPropGetter(event: any) {
  const base = getCalBg(event.calendarId) || '#888';
  const isFree = (event as any)?.transparency === 'transparent';
  const cat = event.importance || 'other';
  const baseStyle = (IMPORTANCE_STYLES as any)[cat] || { backgroundColor: base };
  const style: any = { ...baseStyle };
  style.outline = '0px solid transparent';
  style.boxShadow = '0 0 0 0 transparent';
  // default opacity if not anchored view
  let opacity = isFree ? 0.6 : 0.9;
  // try to resolve stage (lazy)
  var stage = getStageForEvent(event);

  // anchoring: dim everything that isn't linked to the current opty
  if (__optyAnchor) {
    const evOptyId =
      event?.extended?.private?.opty_id ||
      event?.extended?.shared?.opty_id ||
      undefined;

    const isAnchored = evOptyId && String(evOptyId) === String(__optyAnchor.optyId);
    opacity = isAnchored ? 1.0 : 0.40;

    // subtle visual pop for anchored items
    if (isAnchored) {
      style.outline = 'rgba(120, 118, 120, 0.9) solid 2px';
      style.boxShadow = 'rgb(91 76 20 / 94%) 0px 0px 10px 5px';
    }
  }
  style.opacity = opacity;
  return {
    className: stage ? ('staged stage-' + stage) : undefined,
    style
  };
}

// function rbcOnDrillDown(date: Date, view: string) {
//   // When drilling down from month, jump to the start of that week
//   if (view === 'month') {
//     setFocused(startOfWeek(date)); // you already have setFocused()
//   }
// }

// range: Date[] or { start: Date; end: Date }, view: "day" | "week" | "month" | "agenda"
function inRange(range: any, view: string): { start: Date; end: Date } {
  var start: Date;
  var end: Date;

  if (Array.isArray(range)) {
    // array for month/week/day -> start = first, end = last + 1 day (exclusive)
    start = range[0];
    var last = range[range.length - 1];
    end = new Date(last.getTime() + 24 * 60 * 60 * 1000);
  } else {
    // object { start, end } sometimes for agenda-like ranges
    start = range.start;
    end = new Date(range.end.getTime() + 24 * 60 * 60 * 1000);
  }
  return { start: start, end: end };
}

function selectEvent(ev: any) {
  lastSelected = ev;
  if (store && ev && ev.id && (store as any).setLastSelectedById) {
    (store as any).setLastSelectedById(ev.id);
  }
}
/* ===== Simple renderer that re-renders on data change ===== */
type Root = ReturnType<typeof createRoot>;
let root: Root | null = null;

function $(sel: string): HTMLElement | null { return document.querySelector(sel) as HTMLElement | null; }

function renderInto(containerSelector: string) {
  const el = document.querySelector(containerSelector);
  if (!el) { throw new Error('calendar container not found'); }
  if (!root) { root = createRoot(el as HTMLElement); }
  root.render(
    React.createElement(React.Fragment, null,
      React.createElement(CalendarApp, { events: currentEvents, onRangeChange: onRangeChange }),
      React.createElement(
        'div',
        {
          id: 'calendar-pipeline-strip',
          onClick:() => {try { (window as any).openPipelineDrawer?.(onDrawerClosedCalendar); } catch (e) { console.error(e); }},
          style: {
            height: '1.7rem',
            lineHeight: '1.7rem',
            background: '#fff',
            borderTop: '1px solid #e0e0e0',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
            cursor: 'pointer',
            userSelect: 'none',
            fontSize: '1.2rem',
            fontWeight: 500,
            position: 'sticky',
            bottom: 0,
          }
        },
        'Pipeline',
        React.createElement(
          IconButton,
          {
            size: 'small',
            sx: { p: 0.25 },
          },
          React.createElement(ExpandLessIcon, { fontSize: 'small' })
        )
      )
    )
  );
}

/* --- ICS LOADER (tiny, pragmatic parser) --- */
function parseICS(text: string): CalEvt[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const evts: CalEvt[] = [];
  let cur: any = null;

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].trim();
    if (L === 'BEGIN:VEVENT') cur = {};
    else if (L === 'END:VEVENT' && cur) {
      if (cur.DTSTART && cur.DTEND && cur.SUMMARY) {
        const start = icsDateToJS(cur.DTSTART);
        const end = icsDateToJS(cur.DTEND);
        if (start && end) evts.push({ title: cur.SUMMARY, start, end, allDay: isAllDay(cur.DTSTART, cur.DTEND) } as CalEvt);
      }
      cur = null;
    } else if (cur) {
      const idx = L.indexOf(':'); if (idx > -1) {
        const key = L.slice(0, idx).toUpperCase();
        const val = L.slice(idx + 1);
        if (key.startsWith('DTSTART')) cur.DTSTART = val;
        else if (key.startsWith('DTEND')) cur.DTEND = val;
        else if (key === 'SUMMARY') cur.SUMMARY = val;
        else if (key === 'DESCRIPTION') cur.DESCRIPTION = val;
      }
    }
  }
  return evts;
}
function isAllDay(dtStart: string, dtEnd: string): boolean {
  return /^[0-9]{8}$/.test(dtStart) && /^[0-9]{8}$/.test(dtEnd);
}
function icsDateToJS(s: string): Date | null {
  try {
    if (/^[0-9]{8}$/.test(s)) {
      const y = parseInt(s.slice(0, 4), 10);
      const m = parseInt(s.slice(4, 6), 10) - 1;
      const d = parseInt(s.slice(6, 8), 10);
      return new Date(y, m, d);
    }
    if (/^[0-9]{8}T[0-9]{6}Z$/.test(s)) {
      const y = parseInt(s.slice(0, 4), 10);
      const m = parseInt(s.slice(4, 6), 10) - 1;
      const d = parseInt(s.slice(6, 8), 10);
      const H = parseInt(s.slice(9, 11), 10);
      const M = parseInt(s.slice(11, 13), 10);
      const S = parseInt(s.slice(13, 15), 10);
      return new Date(Date.UTC(y, m, d, H, M, S));
    }
    if (/^[0-9]{8}T[0-9]{6}$/.test(s)) {
      const y = parseInt(s.slice(0, 4), 10);
      const m = parseInt(s.slice(4, 6), 10) - 1;
      const d = parseInt(s.slice(6, 8), 10);
      const H = parseInt(s.slice(9, 11), 10);
      const M = parseInt(s.slice(11, 13), 10);
      const S = parseInt(s.slice(13, 15), 10);
      return new Date(y, m, d, H, M, S);
    }
  } catch (_e) { /* fallthrough */ }
  return null;
}

/* --- Public API exposed on window.CalendarBundle --- */
function initCalendar(containerSelector: string) {
  renderOptyBanner();        // <-- add this line
  renderInto(containerSelector);
}


// --- Toolbar host (selectors + banner side-by-side) ---
function ensureToolbar(): { left: HTMLElement; right: HTMLElement } {
  let bar = document.getElementById('cal-toolbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'cal-toolbar';
    const calRoot = document.querySelector('#calendar-root');
    const parent = calRoot?.parentElement || document.body;
    parent.insertBefore(bar, calRoot || null);
  }

  Object.assign(bar.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
  });

  let left = document.getElementById('cal-toolbar-left');
  if (!left) {
    left = document.createElement('div');
    left.id = 'cal-toolbar-left';
    Object.assign(left.style, {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '12px',
      flex: '0 0 auto',   // content-sized
    });
    bar.appendChild(left);
  }

  let right = document.getElementById('cal-toolbar-right');
  if (!right) {
    right = document.createElement('div');
    right.id = 'cal-toolbar-right';
    Object.assign(right.style, {
      display: 'flex',
      alignItems: 'stretch',
      gap: '8px',
      flex: '1 1 auto',   // take all remaining width
      minWidth: 0,        // allow child to shrink
    });
    bar.appendChild(right);
  }

  return { left, right };
}


function renderCalendarSelector(): void {
  // Mount selectors into toolbar-left
  const { left } = ensureToolbar();
  let host = document.getElementById('cal-list');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cal-list';
    left.appendChild(host);
  }

  type Cal = typeof gCalendars[number];
  const mine  = gCalendars.filter((c:Cal)=>c.group==='mine');
  const other = gCalendars.filter((c:Cal)=>c.group==='other');

  const CAL_W = 135; // controlled width

  const valueMine  = Array.from(selectedIds).filter(id => mine.some(c=>c.id===id));
  const valueOther = Array.from(selectedIds).filter(id => other.some(c=>c.id===id));

  function onChangeMine(ev: any) {
    const nextMine: string[] = ev?.target?.value || [];
    const keepOther = Array.from(selectedIds).filter(id => other.some(c=>c.id===id));
    const next = new Set<string>([...nextMine, ...keepOther]);
    selectedIds = next;
    if (store) store.setSelected(next);
  }
  function onChangeOther(ev: any) {
    const nextOther: string[] = ev?.target?.value || [];
    const keepMine = Array.from(selectedIds).filter(id => mine.some(c=>c.id===id));
    const next = new Set<string>([...keepMine, ...nextOther]);
    selectedIds = next;
    if (store) store.setSelected(next);
  }

  // compact menu
  const MenuProps = {
    PaperProps: { sx: { maxHeight: 280 } },
    MenuListProps: { dense: true }
  };

  const root = (host as any).__muiRoot || createRoot(host);
  (host as any).__muiRoot = root;

  root.render(
    React.createElement(ThemeProvider as any, { theme: compactTheme },
      React.createElement(Box as any, { sx:{ display:'flex', gap:1.5, flexWrap:'wrap', alignItems:'center' } },
        React.createElement(
          Button as any,
          { variant:'contained', onClick:() => {try { (window as any).openCaptureDialog?.(); } catch (e) { console.error(e); }}},
          'Capture gig/contract'
        ),
        React.createElement(
          Button as any,
          { variant:'contained', color: 'error',onClick:() => {try { (window as any).openPipelineDrawer?.(onDrawerClosedCalendar); } catch (e) { console.error(e); }}},
          'Pipeline'
        ),
        React.createElement(
          Button as any,
          { variant:'contained',
            onClick: (e: any) => { e.stopPropagation(); try { (window as any).switchTab?.('settings'); } catch (e) { console.error(e); } },
            sx: {
              bgcolor: 'grey.400',
              color: 'common.white',
              padding: "6px",
              minWidth: '32px',
              '&:hover': { bgcolor: 'grey.500' },
            }
          }, React.createElement(Settings as any, { fontSize: 'small' })
        ),
        // My calendars
        React.createElement(FormControl as any, { sx:{ width: CAL_W }, size:'small' },
          React.createElement(InputLabel as any, { id:'sel-mine-label' }, 'My calendars'),
          React.createElement(Select as any, {
            labelId:'sel-mine-label',
            multiple:true,
            value:valueMine,
            label:'My calendars',
            onChange:onChangeMine,
            size:'small',
            MenuProps,
            sx:{
              '& .MuiSelect-select': { py: 0.5 }, // tighter input
              '& .MuiInputBase-input': { fontSize: 13 }
            },
            renderValue:(ids:string[])=>{
              const names = ids.map(id => mine.find(c=>c.id===id)?.summary || id);
              return names.join(', ') || 'None';
            }
          },
            ...mine.map(c =>
              React.createElement(MenuItem as any, { key:c.id, value:c.id, dense:true },
                React.createElement(Checkbox as any, { size:'small', checked:selectedIds.has(c.id) }),
                React.createElement(ListItemText as any, { primary:c.summary + (c.primary?' (primary)':''), primaryTypographyProps:{ fontSize:13 } })
              )
            )
          )
        ),
        // Other calendars
        React.createElement(FormControl as any, { sx:{ width: CAL_W }, size:'small' },
          React.createElement(InputLabel as any, { id:'sel-other-label' }, 'Other calendars'),
          React.createElement(Select as any, {
            labelId:'sel-other-label',
            multiple:true,
            value:valueOther,
            label:'Other calendars',
            onChange:onChangeOther,
            size:'small',
            MenuProps,
            sx:{
              '& .MuiSelect-select': { py: 0.5 },
              '& .MuiInputBase-input': { fontSize: 13 }
            },
            renderValue:(ids:string[])=>{
              const names = ids.map(id => other.find(c=>c.id===id)?.summary || id);
              return names.join(', ') || 'None';
            }
          },
            ...other.map(c =>
              React.createElement(MenuItem as any, { key:c.id, value:c.id, dense:true },
                React.createElement(Checkbox as any, { size:'small', checked:selectedIds.has(c.id) }),
                React.createElement(ListItemText as any, { primary:c.summary, primaryTypographyProps:{ fontSize:13 } })
              )
            )
          )
        )
      )
    )
  );
}



function computeDefaultRange(): { timeMinISO: string; timeMaxISO: string } {
  const now = new Date();
  const min = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const max = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  return { timeMinISO: min.toISOString(), timeMaxISO: max.toISOString() };
}

function setRangeFromRBC(range: any): void {
  let start: Date | null = null;
  let end: Date | null = null;
  if (Array.isArray(range) && range.length) { start = range[0]; end = range[range.length - 1]; }
  else if (range && range.start && range.end) { start = range.start; end = range.end; }
  if (start && end) currentRange = { timeMinISO: start.toISOString(), timeMaxISO: end.toISOString() };
}

function onRangeChange(range: any): void {
  setRangeFromRBC(range);
  if (store) store.setRangeFromRBC(range);
}

function setFocused(d: Date) {
  focusedDate = d;
  if (store) store.focus(d);
  renderInto('#calendar-root');
}

function getActiveCalendarId(): string {
  if (store) return store.getActiveCalendarId();
  if (selectedIds.size > 0) return Array.from(selectedIds)[0];
  const primary = gCalendars.find(function (c) { return !!c.primary; });
  if (primary) return primary.id;
  if (gCalendars[0]) return gCalendars[0].id;
  throw new Error('No calendars available');
}
function getCalMeta(calId: string | undefined) {
  if (!calId) return undefined;
  return gCalendars.find(function (c) { return c.id === calId; });
}
function getCalBg(calId: string | undefined) {
  return getCalMeta(calId)?.bg || '#888';
}
function getCalTZ(calId: string | undefined) {
  return getCalMeta(calId)?.timeZone || undefined;
}

/* ===== Data operations via Store (kept with same public signatures/flow) ===== */
function listCalendars(): Promise<void> {
  if (!store) return Promise.reject(new Error('No Google client'));
  return store.loadCalendars().catch(function (err) {
    console.error('Error fetching calendars:', err);
  });
}

function loadSelectedCalendars(): Promise<void> {
  if (!store) return Promise.reject(new Error('No Google client'));
  return store.refreshEvents().then(function () {
    /* render handled by subscription */
  });
}

let _autoRefreshTimer: any = null; // kept for parity (unused by store)
function startAutoRefresh() {
  if (!store) return;
  if (_autoRefreshTimer) return;
  store.startAutoRefresh(10000);
  // keep a dummy handle to satisfy original invariant
  _autoRefreshTimer = true;
}

function setCalendarStore(s: ICalendarStore) {
  store = s;

  // subscribe to store → mirror local view state and render
  store.subscribe(function (snp) {
    snap = snp;
    gCalendars = snp.calendars as any;
    selectedIds = new Set(snp.selectedIds);
    currentEvents = snp.events.slice();
    currentRange = snp.range ? { ...snp.range } : null;
    focusedDate = snp.focusedDate;
    lastSelected = snp.lastSelected || null;
    if (!__appliedBizDefault && snp.calendars && snp.calendars.length) {
      const biz = getBizCalId();
      if (biz && snp.calendars.some((c:any)=>c.id===biz)) {
        try {
          store!.setSelected(new Set([biz]));   // ONLY business calendar
          selectedIds = new Set([biz]);         // update local mirror immediately
        } catch {}
        __appliedBizDefault = true;
      } else {
        __appliedBizDefault = true; // avoid looping if not found
      }
    }
    renderCalendarSelector();
    refreshOptyStageCache();
    renderInto('#calendar-root');
  });

  store.onError(function (_e) {
    // keep parity: no UI surface here
  });
}

function canWrite(calId: string | undefined) {
  if (!store) return false;
  return store.canWrite(calId);
}

// calendar.tsx
function createEventAdvanced(
  title: string,
  start: Date,
  end: Date,
  description: string | undefined,
  calId: string,
  opts: AdvancedOpts
): Promise<any> {
  if (!store) return Promise.reject(new Error('No Google client'));

  const incoming = (opts as any)?.extendedPrivate || {};
  const explicit = incoming?.opty_id;        // from create-link
  const fromAnchor = __optyAnchor?.optyId ? String(__optyAnchor.optyId) : undefined;

  const extendedPrivate = Object.assign(
    {},
    incoming,
    (explicit ? { opty_id: String(explicit) } : {}),   // EXPLICIT WINS
    (!explicit && fromAnchor ? { opty_id: fromAnchor } : {}) // else fall back to anchor
  );

  const optsWithAnchor: AdvancedOpts =
    Object.keys(extendedPrivate).length > 0
      ? Object.assign({}, opts, { extendedPrivate })
      : opts;

  return store.createAdvanced(calId, title, start, end, description, optsWithAnchor)
    .then(function (mapped) {
      lastSelected = mapped || null;
      return mapped;
    });
}



function updateSelectedEventAdvanced(
  title: string | undefined,
  description: string | undefined,
  start: Date,
  end: Date,
  calId: string,
  opts: AdvancedOpts
): Promise<any> {
  if (!store) return Promise.reject(new Error('No Google client'));
  if (!lastSelected || !lastSelected.id) return Promise.reject(new Error('No event selected'));

  const currentCalId = lastSelected.calendarId || getActiveCalendarId();
  if (!canWrite(currentCalId) && calId === currentCalId) {
    toast('This calendar is read-only. Move the event to a writable calendar first.');
    return Promise.reject(new Error('read-only calendar'));
  }

  // Merge anchor → extendedPrivate (do not drop incoming values)
  const extendedPrivate = Object.assign(
    {},
    (opts as any)?.extendedPrivate || {},
    (__optyAnchor?.optyId ? { opty_id: String(__optyAnchor.optyId) } : {})
  );
  const optsWithAnchor: AdvancedOpts = Object.assign({}, opts, { extendedPrivate });

  function doPatch(effectiveCalId: string) {
    return store!.updateAdvanced(
      effectiveCalId,
      lastSelected.id,
      title,
      start,
      end,
      description,
      optsWithAnchor
    );
  }
  function afterWrite(mapped: CalEvt) {
    lastSelected = mapped;
    return mapped;
  }

  if (calId !== currentCalId) {
    return moveEventToCalendar(currentCalId, lastSelected.id, calId)
      .then(function () { return doPatch(calId); })
      .then(afterWrite);
  }
  return doPatch(currentCalId).then(afterWrite);
}


function createEventQuick(title: string, start: Date, end: Date, description?: string): Promise<any> {
  if (!store) return Promise.reject(new Error('No Google client'));
  const calId = getActiveCalendarId();
  return store.createQuick(calId, title, start, end, description)
    .then(function (mapped) {
      lastSelected = mapped || null;
      return mapped;
    });
}

function updateSelectedEvent(changes: { title?: string; description?: string; start?: Date; end?: Date }): Promise<any> {
    if (!store) return Promise.reject(new Error('No Google client'));
    if (!lastSelected || !lastSelected.id) return Promise.reject(new Error('No event selected'));

    const calId =
      (lastSelected && lastSelected.calendarId) ||
      (currentEvents.find(function (e: any) { return e.id === lastSelected.id; })?.calendarId) ||
      getActiveCalendarId();

    const isAllDay = !!lastSelected.allDay;
    const start = changes.start ? new Date(changes.start) : new Date(lastSelected.start);
    const end   = changes.end   ? new Date(changes.end)   : new Date(lastSelected.end);

    const title = (changes.title !== undefined) ? changes.title : lastSelected.title;
    const desc  = (changes.description !== undefined) ? changes.description : lastSelected.desc;

    // opts are the only non-UI part the store/client should interpret
    const opts: AdvancedOpts = {
      isAllDay,
      timeZone: getCalTZ(calId),
    };

    return store.updateAdvanced(
        calId,
        lastSelected.id,
        title,
        start,
        end,
        desc,
        opts
      )
      .then(function (mapped) {
        lastSelected = mapped;
        return mapped;
      });
  }


function deleteSelectedEvent(): Promise<void> {
  if (!store) return Promise.reject(new Error('No Google client'));
  if (!lastSelected || !lastSelected.id) return Promise.reject(new Error('No event selected'));
  const calId = lastSelected.calendarId || getActiveCalendarId();
  const id = lastSelected.id;
  return store.deleteById(calId, id).then(function () {
    lastSelected = null;
  });
}

function updateEventTimeById(id: string, start: Date, end: Date, isAllDayOverride?: boolean): Promise<any> {
  if (!store) return Promise.reject(new Error('No Google client'));
  const found = currentEvents.find(function (e: any) { return e.id === id; });
  const calId = (found && found.calendarId) || (lastSelected && lastSelected.calendarId) || getActiveCalendarId();
  return store.updateTimeById(calId, id, start, end, isAllDayOverride)
    .then(function (mapped) {
      lastSelected = mapped;
      return mapped;
    });
}

/* ===== Drag/Resize handlers ===== */
function handleEventResize(data: any): void {
  var event = data && data.event;
  var start = data && data.start;
  var end   = data && data.end;
  if (!event || !event.id) { toast('No event id on resize.'); return; }
  if (!store) {
    throw(new Error('No Google client'));
  }
  // no RBC flag here → use heuristic
  var targetAllDay = store.isAllDayRange(start, end);

  confirmModal(
    'Change duration for “' + (event.title || '(no title)') + '”?<br>' + new Date(start) + ' → ' + new Date(end),
    function (ok) {
      if (!ok) { renderInto('#calendar-root'); return; }
      updateEventTimeById(event.id, start, end, targetAllDay)
        .catch(function (e) { toast('Resize failed: ' + (e && e.message ? e.message : e)); renderInto('#calendar-root'); });
    }
  );
}


function handleEventDrop(data: any): void {
  try {
    var ev = data.event;
    var newStart = data.start as Date;
    var newEnd = data.end as Date;
    if (!ev || !ev.id) { toast('No event id on drop.'); return; }

    // prefer RBC’s flag; fall back to heuristic
    var targetAllDay = (data && typeof data.allDay === 'boolean')
      ? !!data.allDay
      : store?.isAllDayRange(newStart, newEnd);

    var msg = 'Move "' + (ev.title || '(no title)') + '" to:' +
      '<br>' + newStart.toString() + ' → ' + newEnd.toString() + ' ?';
    confirmModal(msg, function (ok: boolean) {
      if (!ok) { renderInto('#calendar-root'); return; }
      updateEventTimeById(ev.id, newStart, newEnd, targetAllDay)
        .then(function () { /* re-render handled in update */ })
        .catch(function (e) {
          toast('Update failed: ' + (e && e.message ? e.message : e));
          renderInto('#calendar-root');
        });
    });
  } catch (e) {
    toast('Drop handling failed: ' + (e && (e as any).message ? (e as any).message : e as any));
    renderInto('#calendar-root');
  }
}


function renderCalendarSelect(selectedId?: string): string {
  const writable = gCalendars.filter(function (c) { return c.accessRole === 'owner' || c.accessRole === 'writer'; });
  if (!selectedId) {
    const biz = getBizCalId();
    if (biz && writable.some(c=>c.id===biz)) selectedId = biz;
  }
  const opts = writable.map(function (c) {
    return '<option value="' + c.id + '" ' + (selectedId === c.id ? 'selected' : '') + '>' + c.summary + '</option>';
  }).join('');
  return '<select id="f-cal">' + opts + '</select>';
}


function selectedCalendarIdFromForm(): string {
  const sel = document.getElementById('f-cal') as HTMLSelectElement | null;
  return sel?.value || getActiveCalendarId();
}
function moveEventToCalendar(srcCalId: string, eventId: string, destCalId: string) {
  if (!store) return Promise.reject(new Error('No Google client'));
  return store.moveEvent(srcCalId, eventId, destCalId);
}

/* --- Slot double-click support (empty space) --- */
let __lastSlotClickAt = 0;
let __lastSlotStart: Date | null = null;

function isCloseInTime(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) <= 30 * 60 * 1000; // 30 min window
}

function handleSlotSelect(info: any): void {
  try {
    var now = Date.now();
    var start = info && info.start ? info.start as Date : new Date();
    var end   = info && info.end   ? info.end   as Date : new Date(start.getTime() + 60*60*1000);

    setFocused(start);

    if (__lastSlotStart && (now - __lastSlotClickAt) <= 350 && isCloseInTime(start, __lastSlotStart)) {
      openEditorForCreate(start, end);
      __lastSlotClickAt = 0;
      __lastSlotStart = null;
      return;
    }

    __lastSlotClickAt = now;
    __lastSlotStart = start;
  } catch (e) {
    // silent
  }
}

function showOverlay(show: boolean): void {
  var o = $('#cal-modal-overlay') as HTMLElement | null;
  if (!o) return;
  o.style.display = show ? 'flex' : 'none';
}
function formatLocal(dt: Date): string {
  function pad(n: number): string { return (n < 10 ? '0' : '') + n; }
  var y = dt.getFullYear();
  var m = pad(dt.getMonth() + 1);
  var d = pad(dt.getDate());
  var H = pad(dt.getHours());
  var M = pad(dt.getMinutes());
  return y + '-' + m + '-' + d + 'T' + H + ':' + M;
}
function parseLocal(s: string): Date {
  return new Date(s);
}
function atMidnightLocal(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function roundUpToNext30(dt: Date) {
  const d = new Date(dt);
  d.setSeconds(0,0);
  const m = d.getMinutes();
  const add = m % 30 === 0 ? 0 : 30 - (m % 30);
  d.setMinutes(m + add);
  return d;
}
function mins(n:number){ return n*60*1000; }
function normalizeTimes(isAllDay: boolean, start: Date, end: Date): { start: Date, end: Date } {
  if (end < start) { const t = start; start = end; end = t; }
  if (isAllDay) {
    const s = atMidnightLocal(start);
    const e = atMidnightLocal(end);
    if (e <= s) {
      return { start: s, end: new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1) };
    }
    return { start: s, end: e };
  }
  return { start, end };
}

function hadRecurrence(ev:any){ return Array.isArray(ev?.recurrence) && ev.recurrence.length > 0; }

async function getMasterEventId(calId:string, instanceId:string): Promise<string> {
  if (!store) throw new Error('No Google client');
  const inst = await store.getRawEvent(calId, instanceId);
  return inst.recurringEventId || inst.id;
}

// --- MUI Info Dialog root ---
let infoRoot: Root | null = null;
function ensureInfoRoot(): Root {
  let host = document.getElementById('mui-info-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'mui-info-root';
    document.body.appendChild(host);
  }
  if (!infoRoot) infoRoot = createRoot(host);
  return infoRoot;
}


function fmtRange(ev: CalEvt): string {
  const fmt = (d: Date) =>
    d.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: ev.allDay ? undefined : '2-digit',
      minute: ev.allDay ? undefined : '2-digit'
    });
  if (ev.allDay) {
    const endMinus1 = new Date(ev.end);
    endMinus1.setDate(endMinus1.getDate() - 1);
    const sameDay =
      ev.start.getFullYear() === endMinus1.getFullYear() &&
      ev.start.getMonth() === endMinus1.getMonth() &&
      ev.start.getDate() === endMinus1.getDate();
    return sameDay ? fmt(ev.start) : `${fmt(ev.start)} – ${fmt(endMinus1)}`;
  }
  return `${fmt(ev.start)} → ${fmt(ev.end)}`;
}

function getCalName(calId?: string): string {
  if (!calId) return '';
  const meta = gCalendars.find(c => c.id === calId);
  return meta?.summary || calId;
}

function closeInfoPopup() {
  if (!infoRoot) return;
  infoRoot.render(React.createElement(React.Fragment, null)); // unmount
}

let confirmRoot: Root | null = null;
function ensureConfirmRoot(): Root {
  let host = document.getElementById('mui-confirm-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'mui-confirm-root';
    document.body.appendChild(host);
  }
  if (!confirmRoot) confirmRoot = createRoot(host);
  return confirmRoot;
}

function themeConfirm(message: string, title = 'Confirm'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const root = ensureConfirmRoot();
    const close = (ans: boolean) => {
      root.render(React.createElement(React.Fragment, null));
      resolve(ans);
    };
    root.render(
      React.createElement(ThemeProvider as any, { theme: compactTheme },
        React.createElement(Dialog as any, { open: true, onClose: ()=>close(false), maxWidth:'xs', fullWidth:true },
          React.createElement(DialogTitle as any, null, title),
          React.createElement(DialogContent as any, null,
            React.createElement(Typography as any, { variant:'body2' }, message)
          ),
          React.createElement(DialogActions as any, null,
            React.createElement(Button as any, { onClick: ()=>close(false) }, 'No'),
            React.createElement(Button as any, { variant:'contained', onClick: ()=>close(true) }, 'Yes')
          )
        )
      )
    );
  });
}


function openInfoPopup(ev: CalEvt): void {
  const root = ensureInfoRoot();
  const calName = getCalName(ev.calendarId);
  const meet = (ev as any).meetUrl as string | undefined;
  const attendees = (ev.attendees || []) as string[];
  const onEdit = () => { closeInfoPopup(); openEditorForEvent(ev); };

  const onDelete = async () => {
    // Re-use your existing confirm flow for delete (same behavior as editor form)
    closeInfoPopup();
    if (!store) { toast('No Google client'); return; }
    const calId = ev.calendarId || getActiveCalendarId();
    const evId  = ev.id;
    if (!evId) return;

    confirmModal(
      'Delete options:<br><br>' +
      '<button id="del-this">This event</button> ' +
      '<button id="del-future">This & future</button> ' +
      '<button id="del-all" class="danger">All events</button>',
      function () {}
    );
    const one   = document.getElementById('del-this') as HTMLButtonElement;
    const fut   = document.getElementById('del-future') as HTMLButtonElement;
    const all   = document.getElementById('del-all') as HTMLButtonElement;

    const close = function () { showOverlay(false); };

    if (one) one.onclick = async function () {
      try { await store!.deleteThis(calId, evId); close(); }
      catch(e:any){ toast('Delete failed: '+(e?.message||e)); }
    };
    if (all) all.onclick = async function () {
      try { await store!.deleteAll(calId, evId); close(); }
      catch(e:any){ toast('Delete failed: '+(e?.message||e)); }
    };
    if (fut) fut.onclick = async function () {
      try { await store!.deleteThisAndFuture(calId, evId); close(); }
      catch(e:any){ toast('Delete failed: '+(e?.message||e)); }
    };
  };

  const chips = attendees.map(a =>
    React.createElement(Chip as any, { key: a, size: 'small', label: a, sx:{ mr:0.5, mb:0.5 } })
  );

  root.render(
    React.createElement(ThemeProvider as any, { theme: compactTheme },
      React.createElement(Dialog as any, { open: true, onClose: closeInfoPopup, maxWidth: 'sm', fullWidth: true },
        React.createElement(DialogTitle as any, null, ev.title || '(no title)'),
          React.createElement(DialogContent as any, null,
          calName ? React.createElement(
                      React.Fragment, null, React.createElement('span', { style: { fontWeight: '500' } }, 'Calendar: '),
                      React.createElement(Typography as any, { variant: 'body2', component: 'span', sx: { color: 'text.secondary', mb: 1 } }, calName)
                    ) : null,
          // --- Linked Opportunity entry point (as a link) ---
          (function () {
            var hasEvent = !!(ev && ev.id);
            if (!hasEvent) return null;

            // Prefer mapped extended props first (no async), fall back to shared if present
            var optyId =
              (ev.extended && ev.extended.private && ev.extended.private.opty_id) ||
              (ev.extended && ev.extended.shared && ev.extended.shared.opty_id) ||
              null;

            // If no linkage on the event, render nothing
            if (!optyId) return null;

            function onOpenOpty(e) {
              if (e && e.preventDefault) e.preventDefault();
              (async function () {
                try {
                  const retr = new Retrievers(store!);
                  const opty = await retr.fetchOpportunityByEvent(ev);
                  if (!opty) return;

                  const currentAnchorId = __optyAnchor?.optyId ? String(__optyAnchor.optyId) : null;
                  const targetId = String(opty.opty_id || '');
                  const same = currentAnchorId && targetId && currentAnchorId === targetId;

                  if (!__optyAnchor || same) {
                    const evts = await retr.fetchEventsByOptyId(targetId, ev.calendarId) || [];
                    openOptyDetailsDrawer(opty, evts, onDrawerClosedCalendar);
                    // if not anchored yet but user came here, feel free to anchor silently:
                    // if (!__optyAnchor && targetId) window.CalendarUI?.setAnchor?.({ optyId: targetId, meta: opty, focusDate: ev.start });
                    closeInfoPopup();
                    return;
                  }

                  // Different anchor → confirm
                  const ok = await themeConfirm(
                    'Opening this opportunity will detach the current gig from the calendar. Continue?',
                    'Switch opportunity?'
                  );
                  if (!ok) return;

                  // Clear and proceed
                  window.CalendarUI?.clearAnchor?.();
                  const evts = await retr.fetchEventsByOptyId(targetId, ev.calendarId) || [];
                  openOptyDetailsDrawer(opty, evts, onDrawerClosedCalendar);
                  window.CalendarUI?.setAnchor?.({ optyId: targetId, meta: opty, focusDate: ev.start });
                  closeInfoPopup();
                } catch (_e) { /* silent */ }
              })();
            }

            const evOptyId =
              (ev.extended && ev.extended.private && ev.extended.private.opty_id) ||
              (ev.extended && ev.extended.shared  && ev.extended.shared.opty_id) ||
              null;

            const isSameAnchor = evOptyId && __optyAnchor?.optyId && String(evOptyId) === String(__optyAnchor.optyId);
            const linkLabel = isSameAnchor
              ? 'Connected to ' +(__optyAnchor?.meta?.title || 'Current gig/contract')
              : 'Open connected gig/contract';

            return React.createElement(
              Typography,
              { variant: 'body2', sx: { mt: 1 } },
              React.createElement(
                Link,
                { href: '#', onClick: onOpenOpty, underline: 'hover' },
                linkLabel
              )
            );
          })(),

          ev.importance ? React.createElement(
            'div', null, React.createElement('span', { style: { fontWeight: '500' } }, 'Event Type: '),
            React.createElement(Typography as any, { variant: 'body2', component: 'span', sx: { color: 'text.secondary', mb: 1 } }, ev.importance)
          ) : null,
          React.createElement(Typography as any, { variant:'subtitle2', sx:{ mb:0.5 } }, fmtRange(ev)),
          ev.location ? React.createElement(
            React.Fragment, null, React.createElement('span', { style: { fontWeight: '500' } }, 'Location: '),
            React.createElement(Typography as any, { variant: 'body2', component: 'span', sx: { color: 'text.secondary', mb: 1 } }, ev.location)
          ) : null,
          ev.desc ? React.createElement(
            'div', null, React.createElement('span', { style: { fontWeight: '500' } }, 'Notes: '),
            React.createElement(Typography as any, { variant: 'body2', component: 'span', sx: { color: 'text.secondary', mb: 1 } }, ev.desc)
          ) : null,
          (attendees.length
            ? React.createElement(React.Fragment, null,
                React.createElement(Divider as any, { sx:{ my:1.5 } }),
                React.createElement(Typography as any, { variant:'subtitle2', sx:{ mb:0.5 } }, 'Attendees'),
                React.createElement(Stack as any, { direction:'row', flexWrap:'wrap' }, ...chips)
              )
            : null
          ),
          (meet
            ? React.createElement(Typography as any, { variant:'body2', sx:{ mt:1 } },
                React.createElement(Link as any, { href: meet, target:'_blank', rel:'noreferrer' }, 'Open Meet'))
            : null
          ),
          (ev.htmlLink
            ? React.createElement(Typography as any, { variant:'body2', sx:{ mt:1 } },
                React.createElement(Link as any, { href: ev.htmlLink, target:'_blank', rel:'noreferrer' }, 'Open in Google Calendar'))
            : null
          )
        ),
        React.createElement(DialogActions as any, null,
          React.createElement(Button as any, { onClick: closeInfoPopup }, 'Close'),
          // React.createElement(Button as any, { color:'error', onClick: onDelete }, 'Delete'),
          React.createElement(Button as any, { variant:'contained', onClick: onEdit }, 'Modify')
        )
      )
    )
  );
}


function openEditorForEvent(ev: any): void {
  setFocused(ev?.start || new Date());
  selectEvent(ev);
  renderEditor(true, 'edit', ev);
}

function openEditorForCreate(prefStart?: Date, prefEnd?: Date, link?: { optyId: string; meta?: any }): void {
  const s = prefStart || new Date();
  const e = prefEnd   || new Date((prefStart || new Date()).getTime() + 30*60*1000);
  // seed a minimal CalEvt-ish object so the dialog has defaults
  const seed: CalEvt = {
    title: '',
    start: s,
    end: e,
    allDay: false,
    calendarId: getActiveCalendarId(),
    attendees: [],
  };
  setFocused(s);
  renderEditor(true, 'create', seed, link);
}


/* ===== Attendee chips ===== */
function wireAttendeesChips(inputId='f-att', wrapId='f-att-wrap', initial: string[] = []) {
  const input = document.getElementById(inputId) as HTMLInputElement;
  const wrap  = document.getElementById(wrapId) as HTMLElement;
  if (!input || !wrap) return;

  wrap.classList.add('att-wrap');
  input.classList.add('att-input');

  const emails = new Set<string>();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function addMany(raw: string) {
    raw.split(/[, \n\r\t]+/)
      .map(function (s){ return s.trim(); })
      .filter(Boolean)
      .forEach(function (s){ if (emailRe.test(s)) emails.add(s); });
    render();
  }

  function render() {
    wrap.querySelectorAll('.att-chip').forEach(function (n){ n.remove(); });

    const frag = document.createDocumentFragment();
    Array.from(emails).forEach(function (e) {
      const chip = document.createElement('span');
      chip.className = 'att-chip';
      chip.dataset.email = e;

      const txt = document.createElement('span');
      txt.textContent = e;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'att-chip-remove';
      btn.setAttribute('aria-label', 'Remove ' + e);
      btn.textContent = '×';
      btn.addEventListener('click', function () { emails.delete(e); render(); });

      chip.appendChild(txt);
      chip.appendChild(btn);
      frag.appendChild(chip);
    });

    wrap.insertBefore(frag, input);
  }

  addMany(initial.join(' '));

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = input.value.trim();
      if (v) { addMany(v); input.value = ''; }
    } else if (e.key === 'Backspace' && input.value === '') {
      const last = Array.from(emails).pop();
      if (last) { emails.delete(last); render(); }
    }
  });

  input.addEventListener('paste', function (e: ClipboardEvent) {
    const t = e.clipboardData?.getData('text') || '';
    if (t && /[, \n\r\t]/.test(t)) {
      e.preventDefault();
      addMany(t);
    }
  });

  (input as any).__getEmails = function () { return Array.from(emails); };
  (input as any).__setEmails = function (arr: string[]) { emails.clear(); addMany((arr || []).join(' ')); };
}

/* ===== Misc utils ===== */
function parseReminderToMinutes(s: string): number | null {
  if (!s) return null;
  const m = String(s).trim().toLowerCase();
  if (/^\d+$/.test(m)) return Math.max(0, parseInt(m,10));
  const rx = /^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)$/;
  const mm = m.match(rx);
  if (!mm) return null;
  const n = parseInt(mm[1],10);
  const unit = mm[2][0];
  const mult = unit === 'm' ? 1 : unit === 'h' ? 60 : unit === 'd' ? 1440 : 10080;
  return Math.max(0, n * mult);
}

function wireClose(): void {
  var x = document.getElementById('btn-close') as HTMLButtonElement | null;
  if (x) x.onclick = function () { showOverlay(false); };
}

function confirmModal(message: string, cb: (ok: boolean)=>void): void {
  var host = $('#cal-modal') as HTMLElement | null;
  if (!host) return;
  host.innerHTML =
    '<button id="btn-close" class="closex" aria-label="Close">&times;</button>' +
    '<h4>Confirm</h4>' +
    '<div style="margin:8px 0 14px 0;color:#444">' + message.replace(/</g,'&lt;') + '</div>' +
    '<div class="actions">' +
    '<span style="flex:1"></span>' +
    '<button id="btn-no">Cancel</button>' +
    '<button id="btn-yes">OK</button>' +
    '</div>';
  showOverlay(true);
  wireClose();
  var no = $('#btn-no') as HTMLButtonElement;
  var yes = $('#btn-yes') as HTMLButtonElement;
  no.onclick = function () { showOverlay(false); cb(false); };
  yes.onclick = function () { showOverlay(false); cb(true); };
}

function toast(msg: string): void {
  var host = $('#cal-modal') as HTMLElement | null;
  if (!host) return;
  host.innerHTML =
    '<button id="btn-close" class="closex" aria-label="Close">&times;</button>' +
    '<div style="padding:10px 12px;color:#b00">' + msg.replace(/</g,'&lt;') + '</div>' +
    '<div class="actions" style="margin-top:4px">' +
    '<span style="flex:1"></span><button id="btn-ok">OK</button>' +
    '</div>';
  showOverlay(true);
  wireClose();
  var ok = $('#btn-ok') as HTMLButtonElement;
  ok.onclick = function () { showOverlay(false); };
}

/* Expose */
function __hasSelection(): boolean { return !!(lastSelected && lastSelected.id); }
function __getSelection(): any { return lastSelected; }
export {
  initCalendar, setCalendarStore,
  createEventQuick, updateSelectedEvent, deleteSelectedEvent, updateEventTimeById,
  openEditorForEvent, openEditorForCreate, __hasSelection, __getSelection, toast as __toast,
};

/* ===== Color utils ===== */
function clamp01(x:number){ return Math.min(1, Math.max(0, x)); }
function hexToRgb(hex:string){
  const h = hex.replace('#','');
  const v = h.length===3 ? h.split('').map(function(c){return c+c;}).join('') : h;
  const n = parseInt(v,16);
  return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
}
function rgbToHex(r:number,g:number,b:number){
  const to = function(n:number){ return n.toString(16).padStart(2,'0'); };
  return '#' + to(r) + to(g) + to(b);
}
function mixHex(ah:string,bh:string,t:number){
  const A=hexToRgb(ah), B=hexToRgb(bh);
  const r=Math.round(A.r*(1-t)+B.r*t);
  const g=Math.round(A.g*(1-t)+B.g*t);
  const b=Math.round(A.b*(1-t)+B.b*t);
  return rgbToHex(r,g,b);
}
function relLuminance(hex:string){
  const c = hexToRgb(hex);
  const tr = (c.r/255)<=0.03928 ? (c.r/255)/12.92 : Math.pow((c.r/255+0.055)/1.055, 2.4);
  const tg = (c.g/255)<=0.03928 ? (c.g/255)/12.92 : Math.pow((c.g/255+0.055)/1.055, 2.4);
  const tb = (c.b/255)<=0.03928 ? (c.b/255)/12.92 : Math.pow((c.b/255+0.055)/1.055, 2.4);
  return 0.2126*tr + 0.7152*tg + 0.0722*tb;
}
function contrastRatio(a:string,b:string){
  const L1 = relLuminance(a), L2 = relLuminance(b);
  const hi = L1>L2 ? L1 : L2;
  const lo = L1>L2 ? L2 : L1;
  return (hi+0.05)/(lo+0.05);
}
function bestTextColor(bg:string,_isFree:boolean,_importance?: string){
  // prefer white; fall back to black if white fails typical 4.5:1 threshold
  return contrastRatio(bg, '#ffffff') >= 4.5 ? '#ffffff' : '#000000';
}
function darken(hex:string, amount:number){
  return mixHex(hex, '#000000', clamp01(amount));
}
function computeDisplayColors(googleBg: string, isFree: boolean, _importance?: string){
  const amt = isFree ? COLOR_STRENGTH_FREE : COLOR_STRENGTH_OPAQUE;
  const bg  = darken(googleBg, amt);
  const border = darken(googleBg, amt + 0.12);
  const text = bestTextColor(bg, isFree, _importance);
  return { bg, border, text };
}
