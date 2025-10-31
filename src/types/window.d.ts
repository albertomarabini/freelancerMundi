// src/types/window.d.ts
export type OptyAnchor = { optyId: string; meta?: any; focusDate?: Date | null } | null;

declare global {
  interface Window {
    CalendarUI?: {
      // single, canonical shape:
      setAnchor?: (p: OptyAnchor) => void;         // no null here; use clearAnchor()
      clearAnchor?: () => void;
      getAnchor?: () => OptyAnchor | null;
    };

    // (optional extras you use elsewhere)
    panel?: {
      anchorCalendarToOpty?: (row: any, focusDate?: Date | null) => void;
    };

    settings?: { business_calendar?: string | null };
  }
}

export {};
