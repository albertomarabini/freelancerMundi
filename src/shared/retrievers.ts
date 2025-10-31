// OptyRetriever.ts
import type { ICalendarStore, RangeISO } from "../lib/state/CalendarStore";
import type { CalEvt } from "../types/interfaces";
import type { Opty } from "../types/interfaces";


export class Retrievers {
  private store: ICalendarStore;

  public constructor(store: ICalendarStore) {
    this.store = store;
  }

  public async fetchOpportunityByEvent(ev: CalEvt): Promise<Opty | null> {
    const calId = ev.calendarId || this.store.getActiveCalendarId();
    const evId  = ev.id;
    let ext = null;
    if (!evId) return null;
    if (!!(ev as any).extended) {
      ext = (ev as any).extended;
    } else {
      const raw = await this.store.getRawEvent(calId, evId);
      ext = raw?.extendedProperties || {};
    }
    const optyId = (ext as any).private?.opty_id || (ext as any).shared?.opty_id || null;

    if (!optyId) return null;

    const res = await chrome.runtime.sendMessage({ type: "job/byOptyId", opty_id: String(optyId) });
    if (!res?.ok) throw new Error(res?.error || "findByOpty failed");
    return (res.data as Opty) || null;
  }

  public async fetchEventsByOptyId(optyId: string, calendars?:string | string[], range?: RangeISO): Promise<CalEvt[]> {
    if (!optyId) return [];
    if (calendars && typeof calendars === "string"){
      calendars = [calendars as string];
    }
    let cl: string[] | undefined = calendars as any
    return this.store.fetchEventsByOptyId(optyId, cl, range);
  }
}
