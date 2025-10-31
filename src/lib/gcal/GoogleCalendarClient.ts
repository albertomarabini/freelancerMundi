// src/lib/gcal/GoogleCalendarClient.ts

// Minimal shared types so this file is self-contained.
// If you already have a separate types file, feel free to delete these
// and import from your own "./types".


export type TokenProvider = (force?: boolean) => Promise<string>;

type GoogleJsonError = {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };
};
import type { CreateCalendarInput, AdvancedOpts, CalendarMeta, CalEvt, Importance, Transparency, Visibility, ExtendedProps } from '../../types/interfaces';
export class GoogleCalendarClient {
  private tokenProvider: TokenProvider;

  constructor(tokenProvider: TokenProvider) {
    this.tokenProvider = tokenProvider;
  }

  /* =======================
   * Public API
   * ======================= */

  public async listCalendars(): Promise<CalendarMeta[]> {
    const res = await this.apiGet('users/me/calendarList', {
      maxResults: '250',
      showHidden: 'true',
    });

    const items = (res && res.items) || [];
    return items.map(function (c: any): CalendarMeta {
      const group =
        c && (c.accessRole === 'owner' || c.primary) ? 'mine' : 'other';
      return {
        id: c.id,
        summary: c.summary || c.id,
        primary: !!c.primary,
        bg: c.backgroundColor,
        timeZone: c.timeZone,
        accessRole: c.accessRole,
        selectedFlag: !!c.selected,
        group: group,
      };
    });
  }

  public async listEvents(
    calendarId: string,
    timeMinISO: string,
    timeMaxISO: string,
    maxResults: number = 2500,
    extFilter?: { private?: Record<string, string>; shared?: Record<string, string> }
  ): Promise<CalEvt[]> {
    const params: Record<string, string | string[]> = {
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      maxResults: String(maxResults),
    };

    // server-side filter by extended properties
    if (extFilter?.private) {
      const arr: string[] = [];
      for (const [k, v] of Object.entries(extFilter.private)) arr.push(`${k}=${v}`);
      if (arr.length) params.privateExtendedProperty = arr;
    }
    if (extFilter?.shared) {
      const arr: string[] = [];
      for (const [k, v] of Object.entries(extFilter.shared)) arr.push(`${k}=${v}`);
      if (arr.length) params.sharedExtendedProperty = arr;
    }

    const res = await this.apiGet(
      'calendars/' + encodeURIComponent(calendarId) + '/events',
      params
    );

    const items = (res && res.items) || [];
    const out: CalEvt[] = [];
    for (let i = 0; i < items.length; i++) {
      const mapped = GoogleCalendarClient.mapGEvent(items[i], calendarId);
      if (mapped) out.push(mapped);
    }
    return out;
  }

  public async createEvent(
    calendarId: string,
    body: any,
    opts?: { conference?: boolean; sendUpdates?: boolean }
  ): Promise<CalEvt> {
    const params: Record<string, string> = {};
    if (opts && opts.sendUpdates) params.sendUpdates = 'all';
    if (opts && opts.conference) params.conferenceDataVersion = '1';

    const res = await this.apiReq(
      'POST',
      'calendars/' + encodeURIComponent(calendarId) + '/events',
      params,
      body
    );
    const mapped = GoogleCalendarClient.mapGEvent(res, calendarId);
    if (!mapped) throw new Error('Failed to map created event');
    return mapped;
  }

  public async updateEvent(
    calendarId: string,
    eventId: string,
    body: any,
    opts?: { conference?: boolean; sendUpdates?: boolean }
  ): Promise<CalEvt> {
    const params: Record<string, string> = {};
    if (opts && opts.sendUpdates) params.sendUpdates = 'all';
    if (opts && opts.conference) params.conferenceDataVersion = '1';

    const res = await this.apiReq(
      'PATCH',
      'calendars/' +
        encodeURIComponent(calendarId) +
        '/events/' +
        encodeURIComponent(eventId),
      params,
      body
    );
    const mapped = GoogleCalendarClient.mapGEvent(res, calendarId);
    if (!mapped) throw new Error('Failed to map updated event');
    return mapped;
  }


  /** Deletes every event in a calendar that has private.extendedProperties.opty_id === optyId.
   *  Collapses instances to their recurring master to avoid partial series leftovers.
   *  Returns how many delete requests were issued.
   */
  public async deleteAllEventsForOpty(calendarId: string, optyId: string): Promise<number> {
    if (!calendarId || !optyId) return 0;

    // We need a wide window because events.list requires bounds when ordering by startTime.
    const timeMin = '1970-01-01T00:00:00Z';
    const timeMax = '2100-01-01T00:00:00Z';

    let pageToken: string | undefined = undefined;
    const uniqueIds = new Set<string>();

    do {
      const url = new URL('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events');
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('timeMin', timeMin);
      url.searchParams.set('timeMax', timeMax);
      url.searchParams.set('maxResults', '2500');
      url.searchParams.append('privateExtendedProperty', `opty_id=${optyId}`);
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const headers = await this.authHeader();
      const r = await this.fetchWithAuthRetry(url.toString(), { method: 'GET', headers });
      if (!r.ok) {
        const txt = await r.text().catch(()=>'');
        let j: any = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
        const reason = j?.error?.status; const msg = j?.error?.message || `Google API ${r.status}`;
        const err = new Error(msg) as any; err.status = r.status; err.reason = reason; throw err;
      }

      const data = await r.json();
      const items: any[] = data?.items || [];
      for (let i = 0; i < items.length; i++) {
        const ev = items[i];
        const masterId = ev?.recurringEventId || ev?.id;
        if (masterId) uniqueIds.add(masterId);
      }
      pageToken = data?.nextPageToken;
    } while (pageToken);

    // Delete each unique (master) id, safely
    let deletes = 0;
    for (const id of uniqueIds) {
      try { await this.safeDeleteEvent(calendarId, id); deletes++; } catch { /* best-effort */ }
    }
    return deletes;
  }


  public async deleteEvent(
    calendarId: string,
    eventId: string
  ): Promise<void> {
    await this.apiReq(
      'DELETE',
      'calendars/' +
        encodeURIComponent(calendarId) +
        '/events/' +
        encodeURIComponent(eventId)
    );
  }

  public async safeDeleteEvent(calendarId: string, eventId: string): Promise<void> {
    // Try direct delete first.
    try {
      await this.deleteEvent(calendarId, eventId);
      return;
    } catch (_e) {
      // fall through to master-aware path
    }

    // If direct delete failed, fetch and try master (covers series/linked edge cases)
    let ev: any;
    try {
      ev = await this.getEvent(calendarId, eventId);
    } catch (_e) {
      // If we can't fetch it, assume it's gone or inaccessible → treat as deleted
      return;
    }

    const masterId = ev.recurringEventId || ev.id;
    try {
      await this.deleteEvent(calendarId, masterId);
    } catch (_e2) {
      // As a last resort, re-fetch: if it 404s, we’re good; otherwise rethrow
      try {
        await this.getEvent(calendarId, masterId);
        throw _e2; // still exists → bubble up
      } catch (_e404) {
        // Not found → treat as deleted
      }
    }
  }



  public async moveEvent(
    srcCalendarId: string,
    eventId: string,
    destCalendarId: string
  ): Promise<void> {
    await this.apiReq(
      'POST',
      'calendars/' +
        encodeURIComponent(srcCalendarId) +
        '/events/' +
        encodeURIComponent(eventId) +
        '/move',
      { destination: destCalendarId }
    );
  }

  public async cloneEventToCalendar(
      srcCalendarId: string,
      eventId: string,
      destCalendarId: string
    ): Promise<CalEvt> {
    // 1) fetch source
    const src = await this.getEvent(srcCalendarId, eventId);

    // 2) build a body that preserves as much as possible
    const isAllDay = !!src.start?.date;
    const start = isAllDay ? new Date(src.start.date) : new Date(src.start.dateTime);
    const end   = isAllDay ? new Date(src.end.date)   : new Date(src.end.dateTime);

    // NOTE: buildBodyFrom maps attendees, reminders, recurrence, visibility, transparency, importance,
    // and can recreate Meet if addMeet=true. We preserve Meet only if source had conferenceData/hangoutLink.
    const body = GoogleCalendarClient.buildEventBody({
      title: src.summary,
      desc: src.description,
      start,
      end,
      isAllDay,
      timeZone: src.start?.timeZone || src.end?.timeZone,
      recurrence: src.recurrence,
      attendeesEmails: (src.attendees || []).map((a: any) => a.email).filter(Boolean),
      // If source had custom reminders, preserve them; otherwise leave undefined (use calendar default).
      reminderMinutes: (src.reminders?.useDefault === false)
        ? (src.reminders?.overrides?.find((o: any) => o.method === 'popup')?.minutes ?? null)
        : undefined,
      addMeet: !!(src.conferenceData || src.hangoutLink),
      location: src.location,
      visibility: src.visibility,
      transparency: src.transparency,
      importance: src.extendedProperties?.private?.importance,
      // Optional: copy extended properties (private/shared)
      extendedPrivate: src.extendedProperties?.private,
      extendedShared:  src.extendedProperties?.shared,
    });

    const flags = {
      conference: !!(src.conferenceData || src.hangoutLink),
      sendUpdates: !!((src.attendees || []).length),
    };

    // 3) create on destination
    const created = await this.createEvent(destCalendarId, body, flags);
    return created;
  }


  public async getEvent(calendarId: string, eventId: string): Promise<any> {
    return this.apiGet(
      'calendars/' +
        encodeURIComponent(calendarId) +
        '/events/' +
        encodeURIComponent(eventId),
      {}
    );
  }

  /* =======================
   * Static utilities (reused by UI or tests)
   * ======================= */

  public static mapGEvent(ev: any, calendarId?: string): CalEvt | null {
    const s = ev && ev.start && (ev.start.dateTime || ev.start.date);
    const e = ev && ev.end && (ev.end.dateTime || ev.end.date);
    if (!s || !e) return null;

    const start = ev.start.dateTime
      ? new Date(ev.start.dateTime)
      : new Date(ev.start.date);
    const end = ev.end.dateTime
      ? new Date(ev.end.dateTime)
      : new Date(ev.end.date);
    const allDay = !!(ev.start && ev.start.date);

    const ce: any = {
      title: ev.summary || '(no title)',
      start: start,
      end: end,
      allDay: allDay,
      desc: ev.description,
    };
    ce.id = ev.id;
    ce.htmlLink = ev.htmlLink;
    ce.calendarId = calendarId || (ev.organizer && ev.organizer.email) || undefined;
    ce.attendees = ((ev.attendees || []) as any[])
      .map(function (a: any) {
        return a && a.email;
      })
      .filter(Boolean);
    ce.importance =
      ev.extendedProperties &&
      ev.extendedProperties.private &&
      ev.extendedProperties.private.importance;
    ce.recurrence = ev.recurrence;
    ce.reminders = ev.reminders;
    ce.transparency = ev.transparency;
    ce.visibility = ev.visibility;
    ce.location = ev.location;

    // extended properties surface
    if (ev.extendedProperties) {
      ce.extended = {
        private: ev.extendedProperties.private || undefined,
        shared: ev.extendedProperties.shared || undefined,
      };
    }

    // Meet info
    let meet: string | null = null;
    if (ev.conferenceData && ev.conferenceData.entryPoints) {
      const ep = ev.conferenceData.entryPoints.find(function (p: any) {
        return p && p.entryPointType === 'video';
      });
      if (ep && ep.uri) meet = ep.uri;
    }
    if (!meet && ev.hangoutLink) meet = ev.hangoutLink;
    ce.meetUrl = meet;

    return ce as CalEvt;
  }

  /**
   * Build a Google Calendar API event body (matches your previous builder).
   * - If isAllDay: uses date (with exclusive end date)
   * - Else: uses dateTime (optionally with timeZone)
   * - Handles recurrence, attendees, reminders, Meet, visibility, transparency, importance
   */
  public static buildEventBody(args: {
    title?: string;
    desc?: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
    timeZone?: string;
    recurrence?: string[];
    recurrenceRRULE?: string;
    attendeesEmails?: string[];
    reminderMinutes?: number | null; // null => default, number => override, undefined => leave absent
    addMeet?: boolean;
    location?: string;
    visibility?: Visibility;
    transparency?: Transparency;
    importance?: Importance;

    // optional fields for writing extended properties
    extendedPrivate?: Record<string, string>;
    extendedShared?: Record<string, string>;
  }): any {
    const tz = args.timeZone;
    let startObj: any;
    let endObj: any;

    if (args.isAllDay) {
      const toISODate = function (d: Date): string {
        return d.toISOString().slice(0, 10);
      };
      const endExclusive = new Date(
        args.end.getFullYear(),
        args.end.getMonth(),
        args.end.getDate() + 1
      );
      startObj = { date: toISODate(args.start) };
      endObj = { date: toISODate(endExclusive) };
    } else {
      startObj = { dateTime: args.start.toISOString() };
      endObj = { dateTime: args.end.toISOString() };
      if (tz) {
        startObj.timeZone = tz;
        endObj.timeZone = tz;
      }
    }

    const body: any = {
      summary: args.title,
      description: args.desc,
      start: startObj,
      end: endObj,
    };

    if (args.location) body.location = args.location.trim() || undefined;
    if (args.visibility && args.visibility !== 'default')
      body.visibility = args.visibility;
    if (args.transparency) body.transparency = args.transparency;

    if (Array.isArray(args.recurrence)) {
      body.recurrence = args.recurrence;
    } else if (args.recurrenceRRULE && args.recurrenceRRULE.trim()) {
      body.recurrence = ['RRULE:' + args.recurrenceRRULE.trim()];
    }

    if (args.attendeesEmails && args.attendeesEmails.length) {
      const attendees = args.attendeesEmails
        .map(function (e) {
          return e && e.trim();
        })
        .filter(Boolean)
        .map(function (email) {
          return { email: email as string };
        });
      if (attendees.length) body.attendees = attendees;
    }

    if (args.reminderMinutes !== undefined) {
      if (args.reminderMinutes === null) {
        body.reminders = { useDefault: true };
      } else {
        const mins = Math.max(0, Math.floor(args.reminderMinutes));
        body.reminders = {
          useDefault: false,
          overrides: [{ method: 'popup', minutes: mins }],
        };
      }
    }

    if (args.addMeet) {
      body.conferenceData = {
        createRequest: {
          requestId: 'req-' + Math.random().toString(36).slice(2),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      };
    }

    // ---- NEW/UPDATED: extendedProperties
    if (
      args.importance ||
      (args.extendedPrivate && Object.keys(args.extendedPrivate).length) ||
      (args.extendedShared && Object.keys(args.extendedShared).length)
    ) {
      body.extendedProperties = body.extendedProperties || {};
      // private
      if (args.importance || args.extendedPrivate) {
        const priv: Record<string, string> = {
          ...(body.extendedProperties.private || {}),
        };
        if (args.importance) priv.importance = args.importance;
        if (args.extendedPrivate) Object.assign(priv, args.extendedPrivate);
        if (Object.keys(priv).length) body.extendedProperties.private = priv;
      }
      // shared
      if (args.extendedShared) {
        const sh: Record<string, string> = {
          ...(body.extendedProperties.shared || {}),
          ...args.extendedShared,
        };
        if (Object.keys(sh).length) body.extendedProperties.shared = sh;
      }
    }

    return GoogleCalendarClient.pruneEmpty(body);
  }

  public static buildBodyFrom(
    title: string | undefined,
    desc: string | undefined,
    start: Date,
    end: Date,
    opts: AdvancedOpts
  ): any {
    return GoogleCalendarClient.buildEventBody({
      title, desc, start, end,
      isAllDay: opts.isAllDay,
      timeZone: opts.timeZone,
      recurrence: opts.recurrence,
      recurrenceRRULE: opts.recurrenceRRULE,
      attendeesEmails: opts.attendeesEmails,
      reminderMinutes: opts.reminderMinutes,
      addMeet: opts.addMeet,
      location: opts.location,
      visibility: opts.visibility,
      transparency: opts.transparency,
      importance: opts.importance,

      // passthrough for extended props
      extendedPrivate: opts.extendedPrivate,
      extendedShared: opts.extendedShared,
    });
  }

  /* =======================
   * CRUD Calendar
   * ======================= */

  /** Create a new calendar owned by the authenticated user, optionally set color & selection. */
  public async createCalendar(input: CreateCalendarInput): Promise<CalendarMeta> {
    // 1) create the calendar (calendars.insert)
    const cal = await this.apiReq('POST', 'calendars', {}, {
      summary: input.summary,
      timeZone: input.timeZone,
      description: input.description,
      location: input.location,
    });

    const calId: string = cal.id;

    // 2) (optional) update its calendarList entry with color/selected flags
    const wantsSelected = input.selected !== undefined ? !!input.selected : true;
    const wantsColor = !!input.color;

    if (wantsSelected || wantsColor) {
      const body: any = {};
      if (wantsSelected) body.selected = true;
      if (wantsColor) body.backgroundColor = input.color;

      // colorRgbFormat=true allows hex colors
      await this.apiReq(
        'PATCH',
        'users/me/calendarList/' + encodeURIComponent(calId),
        wantsColor ? { colorRgbFormat: 'true' } : {},
        body
      );
    }

    // 3) fetch its calendarList entry so we can return a CalendarMeta consistent with listCalendars()
    const listEntry = await this.apiGet(
      'users/me/calendarList/' + encodeURIComponent(calId),
      {}
    );

    const group =
      listEntry && (listEntry.accessRole === 'owner' || listEntry.primary) ? 'mine' : 'other';

    const meta: CalendarMeta = {
      id: listEntry.id,
      summary: listEntry.summary || listEntry.id,
      primary: !!listEntry.primary,
      bg: listEntry.backgroundColor,
      timeZone: listEntry.timeZone,
      accessRole: listEntry.accessRole,
      selectedFlag: !!listEntry.selected,
      group,
    };

    return meta;
  }

  /** Permanently deletes a calendar you own. */
  public async deleteCalendar(calendarId: string): Promise<void> {
    await this.apiReq('DELETE', 'calendars/' + encodeURIComponent(calendarId));
  }

  /** Convenience: update the calendar’s color in the user’s list entry. */
  public async setCalendarColor(calendarId: string, hexColor: string): Promise<void> {
    await this.apiReq(
      'PATCH',
      'users/me/calendarList/' + encodeURIComponent(calendarId),
      { colorRgbFormat: 'true' },
      { backgroundColor: hexColor }
    );
  }

  /* =======================
   * Private helpers
   * ======================= */

  private async authHeader(): Promise<Record<string, string>> {
    const token = await this.tokenProvider();
    return { Authorization: 'Bearer ' + token };
  }

  private async fetchWithAuthRetry(url: string, init: RequestInit): Promise<Response> {
    let r = await fetch(url, init);
    if (r.status === 401 || r.status === 403) {
      // force-refresh token then retry once
      const t = await this.tokenProvider(true);
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', 'Bearer ' + t);
      r = await fetch(url, { ...init, headers });
    }
    return r;
  }

  private async apiGet(path: string, params: Record<string, string | string[]>): Promise<any> {
    const url = new URL('https://www.googleapis.com/calendar/v3/' + path);
    Object.keys(params || {}).forEach(k => {
      const v = params[k];
      if (Array.isArray(v)) v.forEach(vv => url.searchParams.append(k, vv));
      else url.searchParams.set(k, v as string);
    });
    const headers = await this.authHeader();
    const r = await fetch(url.toString(), { headers });
    if (r.ok) return r.json();
    const txt = await r.text().catch(() => '');
    let j: GoogleJsonError | null = null;
    try { j = txt ? JSON.parse(txt) : null; } catch {}
    const reason =
      j?.error?.errors?.[0]?.reason || j?.error?.status || undefined;
    const message =
      j?.error?.message || `Google API ${r.status}${reason ? ' ('+reason+')' : ''}`;
    const err = new Error(message) as any;
    err.status = r.status;
    err.reason = reason;
    err.code = j?.error?.code;
    throw err;
  }


  private async apiReq(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    params?: Record<string, string>,
    body?: any
  ): Promise<any> {
    const url = new URL('https://www.googleapis.com/calendar/v3/' + path);
    if (params) Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
    const headers = Object.assign({}, await this.authHeader(), { 'Content-Type': 'application/json' });

    const r = await this.fetchWithAuthRetry(url.toString(), {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });

    if (r.ok) return r.json();
    const txt = await r.text().catch(() => '');
    let j: GoogleJsonError | null = null;
    try { j = txt ? JSON.parse(txt) : null; } catch {}
    const reason = j?.error?.errors?.[0]?.reason || j?.error?.status || undefined;// [ts] Property 'error' does not exist on type 'never'.
    const message =
      j?.error?.message || `Google API ${r.status}${reason ? ' ('+reason+')' : ''}`;
    const err = new Error(message) as any;
    err.status = r.status;
    err.reason = reason;
    err.code = j?.error?.code;
    throw err;
  }


  private static pruneEmpty(o: any): any {
    if (!o || typeof o !== 'object') return o;
    Object.keys(o).forEach(function (k) {
      const v = (o as any)[k];
      if (v === '' || v === undefined || v === null) {
        delete (o as any)[k];
      } else if (Array.isArray(v)) {
        if (!v.length) {
          delete (o as any)[k];
        } else {
          for (let i = 0; i < v.length; i++) {
            GoogleCalendarClient.pruneEmpty(v[i]);
          }
          if (!(o as any)[k].length) delete (o as any)[k];
        }
      } else if (typeof v === 'object') {
        GoogleCalendarClient.pruneEmpty(v);
        if (!Object.keys(v).length) delete (o as any)[k];
      }
    });
    return o;
  }

  // Optional helpers (pure sugar)
  public static getPrivateExt(ev: CalEvt, key: string): string | undefined {
    return ev?.extended?.private?.[key];
  }
  public static getSharedExt(ev: CalEvt, key: string): string | undefined {
    return ev?.extended?.shared?.[key];
  }
}
