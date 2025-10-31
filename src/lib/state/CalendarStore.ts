// src/lib/state/CalendarStore.ts
/************************
# Google Calendar Store
This exposes a UI-agnostic state container around Google Calendar. Rendering is optional; subscribe to state and call CRUD methods.

## Install / Imports

```ts
// Your wiring code (TS/JS)
import { GoogleCalendarClient } from './lib/gcal/GoogleCalendarClient';
import { CalendarStore, type CalendarSnapshot } from './lib/state/CalendarStore';
```

## 1) Provide an OAuth token

```ts
// Must resolve to a valid OAuth access token with Calendar scopes.
const tokenProvider = async (): Promise<string> => {
  // e.g., from your auth layer / chrome.identity / etc.
  return myAuthLayer.getAccessToken();
};
```

## 2) Create client + store

```ts
const gcal = new GoogleCalendarClient(tokenProvider);
const store = new CalendarStore(gcal);
```

## 3) Subscribe to state (headless)

```ts
const unsub = store.subscribe((s: CalendarSnapshot) => {
  // Drive your UI or side-effects:
  // s.calendars, s.selectedIds, s.events, s.range, s.focusedDate, s.lastSelected, s.isRefreshing
  console.log('events', s.events.length, 'refreshing?', s.isRefreshing);
});

const unerr = store.onError((e) => {
  console.error('Calendar error:', e);
});
```

## 4) Connect (load calendars + events + start auto-refresh)

```ts
// Optional: pass a custom initial range. Otherwise defaults to -7d..+90d.
await store.connect( { timeMinISO, timeMaxISO } );
```

## 5) Select calendars & set range

```ts
// Select which calendars to show (IDs from s.calendars)
store.setSelected(new Set(['primary@group.calendar.google.com', 'other@domain.com']));

// Update range from your view (same shape as react-big-calendar’s onRangeChange)
store.setRangeFromRBC({ start: new Date('2025-01-01'), end: new Date('2025-02-01') });

// Drive focus (not required for ops, but kept for parity)
store.focus(new Date());
```

## 6) CRUD

### Create (quick)

```ts
const calId = store.getActiveCalendarId();
const evt = await store.createQuick(
  calId,
  'Standup',
  new Date('2025-02-01T09:00:00'),
  new Date('2025-02-01T09:15:00'),
  'Daily standup'
);
```

### Create (advanced)

```ts
await store.createAdvanced(
  calId,
  'Planning',
  new Date('2025-02-03T10:00:00'),
  new Date('2025-02-03T11:00:00'),
  'Sprint planning',
  {
    isAllDay: false,
    timeZone: 'Europe/Rome',
    attendeesEmails: ['pm@acme.com'],
    reminderMinutes: 15,       // null → default; number → override; undefined → omit
    addMeet: true,             // create Meet link
    location: 'Room A',
    visibility: 'default',     // 'default' | 'public' | 'private' | 'confidential'
    transparency: 'opaque',    // 'opaque' | 'transparent'  (busy/free)
    importance: 'high',        // 'low' | 'medium' | 'high'
    recurrenceRRULE: 'FREQ=WEEKLY;BYDAY=MO', // or use `recurrence: ['RRULE:...']`

    // write custom data
    extendedPrivate: { business: 'true' },
    extendedShared:  { pipelineId: 'abc123' },
  }
);
```

### Update

```ts
await store.updateAdvanced(
  calId,
  evt.id!,                       // event id
  'Planning (updated)',          // title (or undefined to leave unchanged)
  new Date('2025-02-03T10:30:00'),
  new Date('2025-02-03T11:30:00'),
  'Shifted by 30m',
  { isAllDay: false, timeZone: 'Europe/Rome' }
);
```

### Update time only (drag/resize style)

```ts
await store.updateTimeById(
  calId,
  evt.id!,
  new Date('2025-02-03T11:00:00'),
  new Date('2025-02-03T11:30:00')
);
```

### Delete

```ts
await store.deleteById(calId, evt.id!);          // this instance (for non-recurring) or the specific event
await store.deleteAll(calId, instanceId);        // entire series (resolve masterId automatically)
await store.deleteThisAndFuture(calId, instanceId); // split series at instance boundary
```

### Move between calendars

```ts
await store.moveEvent(calId, evt.id!, 'destCalendarId@group.calendar.google.com');
```

### Get raw Google event (passthrough)

```ts
const raw = await store.getRawEvent(calId, evt.id!);
```

## 7) Auto-refresh control (optional)

```ts
store.startAutoRefresh(10_000); // default 10s
store.stopAutoRefresh();
```

## 8) Cleanup

```ts
unsub();
unerr();
store.stopAutoRefresh();
```

## 9) Utility: `isAllDayRange(start: Date, end: Date): boolean`

## 10) NEW optional helpers (non-breaking)

```ts
store.setExtendedFilter({
  private: { business: 'true' },  // only load events tagged like this
  // shared: { pipelineId: 'abc123' },
});

await store.updateExtendedProps(calId, evt.id!, {
  private: { business: 'true', foo: 'bar' },
  shared:  { pipelineId: 'xyz' }
});
```
*/
// CalendarStore.ts
import { CalEvt, CalendarMeta, AdvancedOpts } from '../../types/interfaces';
import { GoogleCalendarClient } from '../gcal/GoogleCalendarClient';

export type RangeISO = { timeMinISO: string; timeMaxISO: string };

export type CalendarSnapshot = {
  calendars: CalendarMeta[];
  selectedIds: Set<string>;
  events: CalEvt[];
  range: RangeISO | null;
  focusedDate: Date;
  lastSelected: CalEvt | null;
  isRefreshing: boolean;
};

export type CalendarStoreListener = (s: CalendarSnapshot) => void;
export type CalendarStoreErrorListener = (e: Error) => void;

export type ICalendarStore = {
  subscribe(fn: (s: any) => void): () => void;
  onError(fn: (e: Error) => void): () => void;

  // getters / selectors
  getActiveCalendarId(): string;
  canWrite(calId?: string): boolean;

  // view / selection
  setSelected(ids: Iterable<string>): void;
  focus(d: Date): void;
  setRangeFromRBC(range: any): void;
  setLastSelectedById(id?: string): void;

  // lifecycle / loading
  loadCalendars(): Promise<void>;
  refreshEvents(): Promise<void>;
  startAutoRefresh(ms?: number): void;
  connect(range?: { timeMinISO: string; timeMaxISO: string }): Promise<void>;

  // CRUD
  createAdvanced(calId: string, title: string, start: Date, end: Date, desc: string | undefined, opts: AdvancedOpts): Promise<CalEvt>;
  createQuick(calId: string, title: string, start: Date, end: Date, desc?: string): Promise<CalEvt>;
  updateAdvanced(calId: string, eventId: string, title: string | undefined, start: Date, end: Date, desc: string | undefined, opts: AdvancedOpts): Promise<CalEvt>;
  updateTimeById(calId: string, id: string, start: Date, end: Date, isAllDayOverride?: boolean): Promise<CalEvt>;
  deleteById(calId: string, id: string): Promise<void>;
  deleteThis(calId: string, instanceId: string): Promise<void>;
  deleteAll(calId: string, instanceId: string): Promise<void>;
  moveEvent(srcCalId: string, eventId: string, destCalId: string): Promise<void>;
  getRawEvent(calId: string, id: string): Promise<any>;
  deleteThisAndFuture(calId: string, instanceId: string): Promise<any>;
  deleteAllEventsForOpty(optyId: string, calId?: string): Promise<number>;

  isAllDayRange: (start: Date, end: Date) => boolean;

  //Extended Props
  setExtendedFilter?: (f?: { private?: Record<string, string>; shared?: Record<string, string> }) => void;
  updateExtendedProps: (calId: string, eventId: string, props: { private?: Record<string, string>; shared?: Record<string, string> }) => Promise<CalEvt>;
  fetchEventsByOptyId(optyId: string, calendars?: string[], range?: RangeISO, ): Promise<CalEvt[]>;
};

export class CalendarStore implements ICalendarStore {
  private gcal: GoogleCalendarClient;
  private calendars: CalendarMeta[] = [];
  private selectedIds = new Set<string>();
  private events: CalEvt[] = [];
  private range: RangeISO | null = null;
  private focusedDate: Date = new Date();
  private lastSelected: CalEvt | null = null;
  private listeners = new Set<CalendarStoreListener>();
  private errListeners = new Set<CalendarStoreErrorListener>();
  private refreshTimer: any = null;
  private inflight = 0;
  private refreshGen = 0;      // incremented per refresh request
  private lastAppliedGen = 0;  // last generation actually applied
  private refreshPeriodMs = 60_000;   // 60s: ~4 calls/min per user (2 cals × 2 calls) stays safe
  private lastRefreshAt = 0;
  private pendingOnce = false;        // one queued refresh while inflight

  private extFilter: { private?: Record<string, string>; shared?: Record<string, string> } | undefined;

  constructor(gcal: GoogleCalendarClient) { this.gcal = gcal; }

  /* ------- subscriptions ------- */
  public subscribe(fn: CalendarStoreListener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }
  public onError(fn: CalendarStoreErrorListener): () => void {
    this.errListeners.add(fn);
    return () => this.errListeners.delete(fn);
  }
  private emit() {
    const s = this.snapshot();
    this.listeners.forEach(f => f(s));
  }
  private snapshot(): CalendarSnapshot {
    return {
      calendars: this.calendars,
      selectedIds: new Set(this.selectedIds),
      events: this.events.slice(),
      range: this.range,
      focusedDate: this.focusedDate,
      lastSelected: this.lastSelected,
      isRefreshing: this.inflight > 0,
    };
  }
  private fail(e: any) {
    const err = e instanceof Error ? e : new Error(String(e));
    this.errListeners.forEach(f => f(err));
  }

  /* ------- state getters ------- */
  public getActiveCalendarId(): string {
    if (this.selectedIds.size) return Array.from(this.selectedIds)[0];
    const primary = this.calendars.find(c => !!c.primary);
    if (primary) return primary.id;
    if (this.calendars[0]) return this.calendars[0].id;
    throw new Error('No calendars available');
  }
  public canWrite(calId?: string) {
    if (!calId) return false;
    const c = this.calendars.find(x => x.id === calId);
    return c?.accessRole === 'owner' || c?.accessRole === 'writer';
  }

  /* ------- lifecycle ------- */
  /** Old app’s connectGoogleAPI(): init() + startAutoRefresh() */
  public async connect(range?: RangeISO): Promise<void> {
    await this.init(range);
    this.startAutoRefresh();
  }

  public async init(range?: RangeISO): Promise<void> {
    this.range = range || this.computeDefaultRange();
    await this.loadCalendars();
    await this.refreshEvents();
  }

  /* ------- calendar selection & view focus ------- */
  public setSelected(ids: Iterable<string>) {
    this.selectedIds = new Set(ids);
    this.refreshEvents().catch(this.fail.bind(this));
    this.emit();
  }
  public focus(d: Date) {
    this.focusedDate = d;
    this.emit();
  }
  public setRangeFromRBC(range: any) {
    let start: Date | null = null, end: Date | null = null;
    if (Array.isArray(range) && range.length) { start = range[0]; end = range[range.length - 1]; }
    else if (range && range.start && range.end) { start = range.start; end = range.end; }
    if (start && end) this.range = { timeMinISO: start.toISOString(), timeMaxISO: end.toISOString() };
    this.refreshEvents().catch(this.fail.bind(this));
  }

  public setExtendedFilter = (f?: { private?: Record<string, string>; shared?: Record<string, string> }) => {
    this.extFilter = f && (Object.keys(f.private || {}).length || Object.keys(f.shared || {}).length) ? f : undefined;
    this.refreshEvents().catch(this.fail.bind(this));
  };


  /* ------- loading ------- */
  public async loadCalendars(): Promise<void> {
    try {
      const items = await this.gcal.listCalendars();
      this.calendars = items;

      // mirror old default selection: primary → selectedFlag → first
      if (this.selectedIds.size === 0) {
        const defaults = items.filter(c => c.primary || c.selectedFlag).map(c => c.id);
        this.selectedIds = new Set(defaults.length ? defaults : (items[0] ? [items[0].id] : []));
      }

      this.emit();
    } catch (e) { this.fail(e); throw e; }
  }

  public async refreshEvents(): Promise<void> {
    if (!this.range) this.range = this.computeDefaultRange();
    if (this.selectedIds.size === 0) { this.events = []; this.emit(); return; }
    if (this.inflight > 0) { this.pendingOnce = true; return; }

    const gen = ++this.refreshGen;
    this.inflight++; this.emit();
    try {
      const ids = Array.from(this.selectedIds);
      const acc: CalEvt[] = [];

      // sequential aggregation across calendars (keeps old behavior)
      for (let i = 0; i < ids.length; i++) {
        const evs = await this.gcal.listEvents(
          ids[i],
          this.range.timeMinISO!,
          this.range.timeMaxISO!,
          2500,
          this.extFilter
        );
        for (let j = 0; j < evs.length; j++) acc.push(evs[j]);
      }

      // drop stale responses (if another refresh started in the meantime)
      if (gen < this.refreshGen) return;

      this.lastAppliedGen = gen;
      this.events = acc;
      this.emit();
    } catch (e) { this.fail(e); throw e; }
    finally {
      this.inflight--;
      this.lastRefreshAt = Date.now();
      // if someone asked for a refresh while we were busy, run exactly once more –
      // but still respect the global cadence (it will reschedule after this finishes)
      if (this.pendingOnce) {
        this.pendingOnce = false;
        // don’t spin: let scheduleAutoTimer enforce cadence
        // If you *must* run immediately (e.g., user drag/resize), call refreshEvents() directly where needed.
      }
      this.scheduleAutoTimer();
      this.emit();
    }
  }

  /* ------- auto refresh ------- */
  public startAutoRefresh(ms = 60_000) {
    this.refreshPeriodMs = Math.max(15_000, ms); // guard: don’t go under 15s
    if (this.refreshTimer) return;
    this.scheduleAutoTimer();
  }
  private scheduleAutoTimer() {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    const now = Date.now();
    const nextAt = (this.lastRefreshAt || now) + this.refreshPeriodMs;
    const delay = Math.max(0, nextAt - now);
    this.refreshTimer = setTimeout(() => {
      if (this.selectedIds.size && this.range) {
        this.refreshEvents().catch(() => { /* ignore transient */ });
      } else {
        // if nothing to do, schedule again later
        this.scheduleAutoTimer();
      }
    }, delay);
  }
  public stopAutoRefresh() {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }

  /* ------- selection helpers ------- */
  public setLastSelectedById(id?: string) {
    this.lastSelected = id ? (this.events.find(e => e.id === id) || null) : null;
    this.emit();
  }
  public getLastSelected() { return this.lastSelected; }

  /* ------- CRUD (1:1 parity with app behavior) ------- */
  public async createAdvanced(
    calId: string,
    title: string,
    start: Date,
    end: Date,
    desc: string | undefined,
    opts: AdvancedOpts
  ): Promise<CalEvt> {
    const body = GoogleCalendarClient.buildBodyFrom(title, desc, start, end, opts);
    const flags = {
      conference: !!opts.addMeet,
      sendUpdates: !!(opts.attendeesEmails && opts.attendeesEmails.length),
    };
    const ev = await this.gcal.createEvent(calId, body, flags);
    this.events = this.events.concat(ev);
    this.lastSelected = ev;
    this.emit();
    return ev;
  }

  public async createQuick(
    calId: string,
    title: string,
    start: Date,
    end: Date,
    desc?: string
  ) {
    return this.createAdvanced(
      calId,
      title,
      start,
      end,
      desc,
      { isAllDay: false }
    );
  }

  public async updateAdvanced(
    calId: string,
    eventId: string,
    title: string | undefined,
    start: Date,
    end: Date,
    desc: string | undefined,
    opts: AdvancedOpts
  ): Promise<CalEvt> {
    const body = GoogleCalendarClient.buildBodyFrom(title, desc, start, end, opts);
    const flags = {
      conference: !!opts.addMeet,
      sendUpdates: !!(opts.attendeesEmails && opts.attendeesEmails.length),
    };
    const ev = await this.gcal.updateEvent(calId, eventId, body, flags);
    const idx = this.events.findIndex(e => e.id === eventId);
    if (idx >= 0) this.events[idx] = ev; else this.events.push(ev);
    this.lastSelected = ev;
    this.emit();
    return ev;
  }

  public async updateTimeById(
    calId: string,
    id: string,
    start: Date,
    end: Date,
    isAllDayOverride?: boolean
  ) {
    const prev = this.events.find(e => e.id === id);
    return this.updateAdvanced(
      calId,
      id,
      prev?.title,
      start,
      end,
      prev?.desc,
      {
        // pick explicit intent if provided; otherwise preserve previous shape
        isAllDay: (isAllDayOverride !== undefined) ? isAllDayOverride : !!prev?.allDay,
        timeZone: this.getCalMeta(calId)?.timeZone,
      }
    );
  }

  public async deleteById(calId: string, id: string): Promise<void> {
    await this.gcal.deleteEvent(calId, id);
    this.events = this.events.filter(e => e.id !== id);
    if (this.lastSelected?.id === id) this.lastSelected = null;
    this.emit();
  }

  /** Single instance delete */
  public async deleteThis(calId: string, id: string) {
    await this.deleteById(calId, id);
  }

  /** Delete entire series (even if given an instance id) */
  public async deleteAll(calId: string, instanceId: string) {
    const inst = await this.gcal.getEvent(calId, instanceId);
    const masterId = inst.recurringEventId || inst.id;
    await this.deleteById(calId, masterId);
    await this.refreshEvents();
  }

  /** Split series at instance → “this & future” */
  public async deleteThisAndFuture(calId: string, instanceId: string) {
    const inst = await this.gcal.getEvent(calId, instanceId);
    const masterId = inst.recurringEventId || inst.id;
    const master = await this.gcal.getEvent(calId, masterId);

    const startISO = inst.start?.dateTime || (inst.start?.date && (inst.start.date + 'T00:00:00Z'));
    const until = new Date(new Date(startISO).getTime() - 1000);
    const untilStr = until.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    const rules: string[] = (master.recurrence || []).slice();
    let rrule = (rules.find(r => r.startsWith('RRULE:')) || 'RRULE:FREQ=DAILY').slice(6);
    rrule = rrule.replace(/;UNTIL=[^;]+/, '');
    const patched = 'RRULE:' + rrule + ';UNTIL=' + untilStr;
    const recOut = [patched].concat(rules.filter(r => !r.startsWith('RRULE:')));
    await this.gcal.updateEvent(calId, masterId, { recurrence: recOut });

    const origRule = rules.find(r => r.startsWith('RRULE:')) || 'RRULE:FREQ=DAILY';
    const cleanRule = origRule.replace(/;UNTIL=[^;]+/, '');

    const newBody: any = {
      summary: master.summary,
      description: master.description,
      location: master.location,
      visibility: master.visibility,
      transparency: master.transparency,
      attendees: master.attendees,
      start: inst.start,
      end:   inst.end,
      recurrence: [cleanRule],
      reminders: master.reminders,
      conferenceData: master.conferenceData ? {
        createRequest: { requestId: 'split-' + Math.random().toString(36).slice(2) }
      } : undefined
    };
    await this.gcal.createEvent(calId, newBody, master.conferenceData ? { conference: true } : undefined);
    await this.refreshEvents();
  }

  public async deleteAllEventsForOpty(optyId: string, calId?: string): Promise<number> {
    if (!optyId) return 0;
    const calendarId = calId || this.getActiveCalendarId();
    if (!this.canWrite(calendarId)) return 0;

    let deleted = 0;
    try {
      deleted = await this.gcal.deleteAllEventsForOpty(calendarId, String(optyId));
    } catch (_e) {
      // best-effort: ignore failures (network/permissions), but don't throw from store
    }
    await this.refreshEvents(); // keep UI in sync after mass delete
    return deleted;
  }


  public async moveEvent(srcCalId: string, eventId: string, destCalId: string): Promise<void> {
    // 1) Try native Google move
    let movedOk = false;
    try {
      await this.gcal.moveEvent(srcCalId, eventId, destCalId);
      movedOk = true;
    } catch (_e) {
      movedOk = false;
    }

    if (!movedOk) {
      // 2) Fallback: clone → safe delete original
      const cloned = await this.gcal.cloneEventToCalendar(srcCalId, eventId, destCalId);
      await this.gcal.safeDeleteEvent(srcCalId, eventId);

      // 3) Replace local snapshot (remove old id, insert new)
      this.events = this.events
        .filter(e => e.id !== eventId)
        .concat({ ...cloned, calendarId: destCalId });
      this.lastSelected = { ...cloned, calendarId: destCalId };

      // 4) Force a fresh load to absorb backend eventual consistency
      await this.refreshEvents();

      // 5) De-dupe by id just in case
      const seen = new Set<string>();
      this.events = this.events.filter(e => {
        if (!e.id) return true;
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });

      this.emit();
      return;
    }

    // Native move path: refresh + de-dupe
    await this.refreshEvents();
    const seen = new Set<string>();
    this.events = this.events.filter(e => {
      if (!e.id) return true;
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    const i = this.events.findIndex(e => e.id === eventId);
    if (i >= 0) {
      this.events[i] = { ...this.events[i], calendarId: destCalId };
      if (this.lastSelected?.id === eventId) this.lastSelected = { ...this.events[i] };
    }
    this.emit();
  }

  public async getRawEvent(calId: string, id: string) {
    return this.gcal.getEvent(calId, id);
  }

  public async updateExtendedProps(
    calId: string,
    eventId: string,
    props: { private?: Record<string, string>; shared?: Record<string, string> }
  ): Promise<CalEvt> {
    // send a minimal patch that only touches extendedProperties
    const body: any = { extendedProperties: {} as any };
    if (props.private && Object.keys(props.private).length) body.extendedProperties.private = props.private;
    if (props.shared && Object.keys(props.shared).length)   body.extendedProperties.shared  = props.shared;

    if (!body.extendedProperties.private && !body.extendedProperties.shared) {
      // nothing to send; return current snapshot event (if any)
      const current = this.events.find(e => e.id === eventId);
      return current || await this.gcal.getEvent(calId, eventId);
    }

    const ev = await this.gcal.updateEvent(calId, eventId, body);
    const idx = this.events.findIndex(e => e.id === eventId);
    if (idx >= 0) this.events[idx] = ev; else this.events.push(ev);
    if (this.lastSelected?.id === eventId) this.lastSelected = ev;
    this.emit();
    return ev;
  }

  public isAllDayRange(start: Date, end: Date): boolean {
    var msDay = 24*60*60*1000;
    return start.getHours()===0 && start.getMinutes()===0 &&
           end.getHours()===0 && end.getMinutes()===0 &&
           ((end.getTime()-start.getTime()) % msDay === 0);
  }

  public async fetchEventsByOptyId(optyId: string, calendars?: string[], range?: RangeISO): Promise<CalEvt[]> {
    if (!optyId) return [];
    const r = range || this.range || this.computeDefaultRange();
    const ids = calendars && calendars.length ? calendars.slice() : (this.calendars.map(function (c){ return c.id; }));
    const out: CalEvt[] = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        const evs = await this.gcal.listEvents(
          ids[i],
          r.timeMinISO!,
          r.timeMaxISO!,
          2500,
          { private: { opty_id: String(optyId) } } // server-side filter
        );
        for (let j = 0; j < evs.length; j++) out.push(evs[j]);
      } catch (_e) { /* ignore calendar we cannot read */ }
    }
    return out;
  }

  /* ------- utilities ------- */
  private getCalMeta(id?: string) {
    return id ? this.calendars.find(c => c.id === id) : undefined;
  }
  private computeDefaultRange(): RangeISO {
    const now = new Date();
    const min = new Date(now.getTime() - 1800 * 24 * 60 * 60 * 1000);
    const max = new Date(now.getTime() + 1800 * 24 * 60 * 60 * 1000);
    return { timeMinISO: min.toISOString(), timeMaxISO: max.toISOString() };
  }

}
