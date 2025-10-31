export type Opty = {
  id?: string;
  url: string | null;
  platform: string | null;
  external_id: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  description_summary: string | null;
  skills: string[];
  budget: string | null;
  rate: string | null;
  post_date: string | null;
  proposal_status: string | null;
  submission_url: string | null;
  status_url: string | null;
  notifications_enabled: boolean;
  notes: string | null;
  bid_amnt: string | null;
  awarded_amnt: string | null;
  funnel_stage: string | null;
  deliverables: string[];
  contacts: Array<any> | null;
  comp_type: string | null;
  comp_text: string | null;
  opty_id: string | null;
  saved_at: string | null;
};

export type OpportunityStage = "examining" | "applied" | "awarded" | "submitted" | "paid";
export const STAGE_COLORS: Record<OpportunityStage, string> = {
  examining: "#4CAF50", // green
  applied:   "#FF9800", // orange
  awarded:   "#F44336", // red
  submitted: "#FFEB3B", // yellow
  paid:      "#2196F3"  // blue
};


//******** GoogleCalendarClient */
export type Importance = 'other'|'submission'|'delivery'|'milestone'|'meeting';
export type Transparency = 'opaque' | 'transparent';
export type Visibility = 'default' | 'public' | 'private' | 'confidential';

export type ExtendedProps = {
  private?: Record<string, string>;
  shared?: Record<string, string>;
};

export type CalEvt = {
  id?: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  desc?: string;
  calendarId?: string;
  attendees?: string[];
  importance?: Importance;
  recurrence?: string[];
  reminders?: any;
  transparency?: Transparency;
  visibility?: Visibility;
  location?: string;
  htmlLink?: string;
  meetUrl?: string | null;

  // raw extended properties mapped from Google (optional)
  extended?: ExtendedProps;
};

export type CalendarMeta = {
  id: string;
  summary: string;
  primary?: boolean;
  bg?: string;
  accessRole?: string;
  selectedFlag?: boolean;
  group: 'mine' | 'other';
  timeZone?: string;
};

export type AdvancedOpts = {
  isAllDay: boolean;
  timeZone?: string;
  recurrenceRRULE?: string;        // e.g. "FREQ=WEEKLY;BYDAY=MO,WE"
  attendeesEmails?: string[];      // array of emails
  reminderMinutes?: number | null; // null → use default
  addMeet?: boolean;               // true to create conference
  location?: string;
  visibility?: Visibility;
  transparency?: Transparency;     // busy vs free
  importance?: Importance;
  recurrence?: string[];

  // values to write to extendedProperties (optional)
  extendedPrivate?: Record<string, string>;
  extendedShared?: Record<string, string>;
};

export type CreateCalendarInput = {
  summary: string;                 // calendar name (required)
  timeZone?: string;
  description?: string;
  location?: string;
  color?: string;                  // hex like "#039be5" (optional)
  selected?: boolean;              // default true
};


export const SUPPORTED_PLATFORMS = [
  ['upwork', 'Upwork'],
  ['freelancer', 'Freelancer'],
  ['fiverr', 'Fiverr'],
  ['toptal', 'Toptal'],
  ['peopleperhour', 'PeoplePerHour'],
  ['guru', 'Guru'],
  ['99designs', '99designs'],
  ['greenhouse', 'Greenhouse'],
] as const;


