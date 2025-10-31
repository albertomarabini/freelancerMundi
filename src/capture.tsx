// src/CaptureApp.tsx
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import {
  Box, Button, Grid, TextField, Typography, IconButton, Select, MenuItem, FormControl, InputLabel, Paper,
  Divider,
  Stack
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import Backdrop from '@mui/material/Backdrop';
import CircularProgress from '@mui/material/CircularProgress';

import { SUPPORTED_PLATFORMS, type Importance, type OpportunityStage } from './types/interfaces'; // 'other'|'submission'|'delivery'|'milestone'|'meeting'
import { compactTheme } from './theme/compactTheme';
import { ICalendarStore } from './lib/state/CalendarStore';

// ---- Types ------------------------------------------------------------
type CompType = string | null;

type Compensation = {
  type: CompType;
  text: string | null;
};

type Contact = {
  name: string;
  role: string;
  email: string;
  phone: string;
  source: 'page';
};

type DeadlineItem = {
  original: string;
  label: Importance;           // matches your gcal Importance union
  when_iso: string | null;
  confidence: number;
};

type Parsed = {
  title: string | null;
  client: string | null;
  location: string | null;
  description_summary: string | null;
  skills: string[];
  compensation: Compensation;
  post_date_raw: string | null;          // normalized to ISO later
  deliverables: string[];
  deadlines_raw: string[];
  contacts: Contact[];
  posting_notes: string | null;
};

type Deterministic = {
  url: string;
  platform: string;
  title?: string;
};

type Settings = { business_calendar: string | null };

type Props = {
  calendarStore: ICalendarStore | null;
  settings: Settings | null;
  onClose?: () => void;
};

type State = {
  status: string;
  // core meta
  url: string;
  platform: string;

  // form fields (replace hidden <input>s)
  title: string;
  company: string;
  location: string;

  summary: string;
  postNotes: string;

  skillsCSV: string;
  compType: CompType;
  compText: string;

  deliverablesText: string;

  contacts: Contact[];
  deadlines: DeadlineItem[];

  canSave: boolean;
  busy: boolean;
  formLocked: boolean;
  funnelStage: OpportunityStage;
};

// ---- Helpers (mostly from your JS, TS-ified) --------------------------
const DEADLINE_TYPES: Importance[] = ['submission','delivery','milestone','meeting','other'];
const OPPORTUNITY_STAGES: OpportunityStage[] = ["examining","applied","awarded","submitted","paid"];
const LIST_MAX_HEIGHT = 90; // px

function pad(n: number): string { return String(n).padStart(2, '0'); }
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(localVal: string): string | null {
  if (!localVal) return null;
  const d = new Date(localVal);
  return d.toISOString();
}
function hostToPlatform(hostname: string): string {
  /*Patch for the POC */
  if(hostname.toLowerCase().indexOf("localhost")!=-1) return "MockMarket";
  /*Normal Flux*/
  const h = (hostname || '').toLowerCase();
  const match = SUPPORTED_PLATFORMS.find(([needle]) => h.includes(needle));
  return match ? match[1] : (hostname || 'Custom');
}
function normalizeContact(x: Partial<Contact> | undefined): Contact {
  return {
    name: (x?.name || '').trim(),
    role: (x?.role || '').trim(),
    email: (x?.email || '').trim(),
    phone: (x?.phone || '').trim(),
    source: 'page'
  };
}
function normalizeParsed(p: any): Parsed | null {
  if (!p || typeof p !== 'object') return null;
  if (!Array.isArray(p.skills)) p.skills = p.skills ? String(p.skills).split(',').map((s: string)=>s.trim()).filter(Boolean) : [];
  if (!Array.isArray(p.deliverables)) p.deliverables = p.deliverables ? [String(p.deliverables)] : [];
  if (!Array.isArray(p.deadlines_raw)) p.deadlines_raw = p.deadlines_raw ? [String(p.deadlines_raw)] : [];
  if (!Array.isArray(p.contacts)) p.contacts = p.contacts ? [p.contacts] : [];
  if (!p.compensation || typeof p.compensation !== 'object') p.compensation = { type: null, text: null };
  if (p.compensation && !['fixed','hourly',null].includes(p.compensation.type)) p.compensation.type = null;
  if (p.compensation.text != null) p.compensation.text = String(p.compensation.text);
  return p as Parsed;
}
function cleanJsonOutput(s: string): string {
  if (!s) return s;
  let t = s.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z]*\n?/, '');
    if (t.endsWith('```')) t = t.slice(0, -3);
    t = t.trim();
  }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a !== -1 && b !== -1 && b > a) t = t.slice(a, b + 1).trim();
  t = t.replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
  return t;
}

// ---- LLM/session shims (same logic, wrapped) --------------------------
declare const LanguageModel: {
  availability(): Promise<'available'|'unavailable'>;
  create(): Promise<{ prompt(q: string): Promise<string> }>;
};

async function ensureSessionRef(): Promise<{ prompt(q: string): Promise<string> }> {
  const avail = await LanguageModel.availability();
  if (avail === 'unavailable') throw new Error('Local model unavailable.');
  return LanguageModel.create();
}

async function getActiveTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab.');
  return tab;
}

async function deterministicExtract(): Promise<Deterministic> {
  const tab = await getActiveTab();
  const tabId = tab.id!;
  const r = await chrome.tabs.sendMessage(tabId, { type: 'page/extract' }).catch(function(){ return null; });
  if (r?.ok) {
    try {
      const u = new URL(r.data?.url || tab.url || '');
      r.data.url = u.href;
      r.data.platform = r.data.platform || hostToPlatform(u.hostname);
    } catch(e) {console.error("Error while ", e) }
    return r.data;
  }
  const exec = await chrome.scripting.executeScript({
    target: { tabId },
    func: function () {
      const meta = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
      const text = document.body ? (document.body as any).innerText : '';
      return { url: location.href, title: document.title, description: text.slice(0, 16000), meta };
    }
  });
  const result: any = exec[0].result;
  try {
    const u = new URL(result.url || tab.url || '');
    result.platform = hostToPlatform(u.hostname);
  } catch(e) {console.error("Error while ", e) }
  return result;
}

// ---- Component ---------------------------------------------------------
export class CaptureApp extends React.Component<Props, State> {
  private session: { prompt(q: string): Promise<string> } | null;
  private postedAtISO: string | null;

  public constructor(props: Props) {
    super(props);
    this.session = null;
    this.postedAtISO = null;
    this.state = this.makeEmptyState();

    // bindings (explicitly allowed)
    this.onCapture = this.onCapture.bind(this);
    this.onSave = this.onSave.bind(this);
    this.addDeadline = this.addDeadline.bind(this);
    this.removeDeadline = this.removeDeadline.bind(this);
    this.updateDeadline = this.updateDeadline.bind(this);
    this.addContact = this.addContact.bind(this);
    this.removeContact = this.removeContact.bind(this);
    this.updateContact = this.updateContact.bind(this);
    this.resetForNewParse = this.resetForNewParse.bind(this);
  }

  private makeEmptyState(): State {
    return {
      status: '',
      url: '',
      platform: '',
      title: '',
      company: '',
      location: '',
      summary: '',
      postNotes: '',
      skillsCSV: '',
      compType: null,
      compText: '',
      deliverablesText: '',
      contacts: [],
      deadlines: [],
      canSave: false,
      busy: false,
      formLocked: true,
      funnelStage: "examining"
    };
  }

  private resetForNewParse(): void {
    this.postedAtISO = null
    const keep = { platform: this.state.platform };
    this.setState(Object.assign(this.makeEmptyState(), keep));
  }

  public async onCapture(): Promise<void> {
    try {
      this.resetForNewParse();
      this.setState({ /*status: 'Capturing…',*/ busy: true });

      const det = await deterministicExtract();
      this.setState({ url: det.url || '', platform: det.platform || '' });

      if (!this.session) this.session = await ensureSessionRef();

      const pageBlob = [
        det.title, (det as any).company, (det as any).location, (det as any).description, (det as any).meta, (det as any).text
      ].filter(Boolean).join('\n\n').slice(0, 16000);

      const prompt = this.makeExtractPrompt(pageBlob);
      const raw = await this.session.prompt(prompt);
      const cleaned = cleanJsonOutput(raw);

      let parsed: Parsed | null = null;
      try { parsed = JSON.parse(cleaned); } catch { parsed = null; }
      parsed = normalizeParsed(parsed);

      if (!parsed) {
        this.setState({ status: '⚠️ Extraction failed (invalid JSON).', canSave: false });
        return;
      }

      const deadlinesStruct = await this.normalizeDeadlines(parsed.deadlines_raw || [], pageBlob);
      const postIso = await this.normalizePostDate(parsed.post_date_raw || '', pageBlob);

      const contacts = (parsed.contacts || []).map(normalizeContact);
      const skillsCSV = (parsed.skills || []).join(', ');
      const deliverablesText = (parsed.deliverables || []).join('\n');
      this.postedAtISO = postIso || null;
      this.setState({
        // status: '✅ Extraction complete.',
        title: parsed.title || det.title || '',
        company: parsed.client || '',
        location: parsed.location || '',
        summary: parsed.description_summary || '',
        postNotes: parsed.posting_notes || '',
        skillsCSV,
        compType: parsed.compensation?.type || null,
        compText: parsed.compensation?.text || '',
        deliverablesText,
        contacts,
        deadlines: deadlinesStruct.length
          ? deadlinesStruct
          : (parsed.deadlines_raw || []).map(function (r: string): DeadlineItem {
              return { original: String(r), label: 'other', when_iso: null, confidence: 0 };
            }),
        canSave: true
      });
    } catch (e: any) {
      this.setState({ status: `⚠️ ${e?.message || e}`, canSave: false });
    } finally {
      this.setState({ busy: false, formLocked: false, });
    }
  }

  public async onSave(): Promise<void> {
    // this.setState({ status: 'Saving…' });
    try {
      const optyId = String(Date.now());
      const calendarStore = this.props.calendarStore || null;
      const settings = this.props.settings || { business_calendar: null };
      const calId = (settings && settings.business_calendar) ||
                    (calendarStore && (function () { try { return calendarStore.getActiveCalendarId(); } catch { return null; } }())) ||
                    null;

      // Build deadlines + optionally create calendar events
      const deadlines_norm: Array<{ comment: string; label: Importance; when_iso: string | null; event_id: string | null }> = [];
      for (let i = 0; i < this.state.deadlines.length; i++) {
        const d = this.state.deadlines[i];
        const base = { comment: d.original || '', label: (DEADLINE_TYPES as string[]).includes(d.label) ? d.label : 'other', when_iso: d.when_iso || null };
        let event_id: string | null = null;

        if (base.when_iso && calendarStore && calId) {
          try {
            const start = new Date(base.when_iso);
            const end = new Date(start.getTime() + 30 * 60 * 1000);
            const titleBits: string[] = [];
            if (this.state.title) titleBits.push(this.state.title);
            if (this.state.title && this.state.company) titleBits.push('-');
            if (this.state.company) titleBits.push(this.state.company);
            const title = titleBits.join(' ');
            const desc: string = [
              base.comment ? `Description: ${base.comment}` : '',
            ].filter(Boolean).join('\n');

            const ev = await calendarStore.createAdvanced(calId, title, start, end, desc, { isAllDay: false, importance: base.label });
            if (calendarStore.updateExtendedProps && ev?.id) {
              await calendarStore.updateExtendedProps(calId, ev.id!, { private: { opty_id: optyId } });
            }
            event_id = ev?.id || null;
          } catch(e) {console.error("Error while creating events", e) }
        }
        deadlines_norm.push(Object.assign({}, base, { event_id }));
      }

      const record = {
        url: this.state.url.trim(),
        platform: this.state.platform.trim(),
        title: this.state.title.trim(),
        company: this.state.company.trim(),
        location: this.state.location.trim(),
        description_summary: this.state.summary.trim() || null,
        skills: this.state.skillsCSV ? this.state.skillsCSV.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [],
        comp_type: this.state.compType || null,
        comp_text: this.state.compText.trim(),
        post_date: this.postedAtISO || new Date().toISOString(),
        deliverables: this.state.deliverablesText ? this.state.deliverablesText.split('\n').map(function (s) { return s.trim(); }).filter(Boolean) : [],
        // deadlines_norm, // keep commented if you don't want to persist yet
        contacts: this.state.contacts.map(normalizeContact),
        notes: null,
        proposal_status: 'new',
        notifications_enabled: false,
        saved_at: new Date().toISOString(),
        opty_id: optyId,
        funnel_stage: this.state.funnelStage,
      };

      const res = await chrome.runtime.sendMessage({ type: 'job/add', job: record });
      if (!res?.ok) throw new Error(res?.error || 'Save failed');
      let job = null;
      let focusDate: Date | null = null;
      try {
        const res = await chrome.runtime.sendMessage({
          type: 'job/byOptyId',
          opty_id: String(optyId),
        });
        job = res?.ok ? (res.data || null) : null;
      } catch(e) {console.error("Error while saving to fb", e) }
      if (job) {
        // optional: try to focus the calendar on the *earliest* deadline (if any)
        try {
          const ds = (this.state.deadlines || [])
            .map(d => d.when_iso ? new Date(d.when_iso) : null)
            .filter(Boolean) as Date[];
          if (ds.length) {
            ds.sort((a, b) => a.getTime() - b.getTime());
            focusDate = ds[0];
          }
        } catch(e) {console.error("Error while mapping appointments", e) }
      }
      if(!job){
        this.setState({ /*status: 'Saved ✓',*/ canSave: false });
        const keep = { platform: this.state.platform };
        this.setState(Object.assign(this.makeEmptyState(), keep, { formLocked: true }));
        setTimeout(() => this.setState({ status: '' }), 1000);
      } else {
        try {
          (window as any).panel?.anchorCalendarToOpty?.(job, focusDate || null);
          try { this.props.onClose?.(); } catch(e) {console.error("Error while ", e) }
        } catch(e) {console.error("Error while anchoring to the rest of the app", e) }
      }
    } catch (e: any) {
      this.setState({ status: e?.message || String(e) });
    }
  }

  // ---------- Normalizers (same logic, localized) ----------
  private async normalizeDeadlines(items: string[], pageSrc: string): Promise<DeadlineItem[]> {
    if (!items || !items.length) return [];
    const nowCtx = { now_iso: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
    const arr = await this.llmNormalizeDeadlinesBatch(items, nowCtx, pageSrc);
    const out = (Array.isArray(arr) ? arr : [arr]) as any[];
    return out.map((r, i) => ({
      original: (r && (r.original ?? items[i])) || String(items[i] || ''),
      label: (r && DEADLINE_TYPES.indexOf(r.label) >= 0) ? r.label : 'other',
      when_iso: r ? (r.when_iso || null) : null,
      confidence: (r && typeof r.confidence === 'number') ? r.confidence : 0
    }));
  }

  private async normalizePostDate(raw: string, pageSrc: string): Promise<string | null> {
    const s = (raw || '').toString().trim();
    if (!s) return null;
    const nowCtx = { now_iso: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' };
    const res = await this.llmNormalizeDeadlinesBatch([s], nowCtx, pageSrc);
    const item = Array.isArray(res) ? (res as any[])[0] : res;
    const iso = item ? (item.when_iso || null) : null;
    return iso || null;
  }

  private async llmNormalizeDeadlinesBatch(snippets: string[], nowCtx: { now_iso: string; tz: string }, pageSrc: string): Promise<any> {
    if (!this.session) this.session = await ensureSessionRef();

    function cleanJsonOutputStrict(s: string): string {
      if (!s) return s;
      let t = s.trim();
      if (t.startsWith('```')) t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
      const firstBrace = t.indexOf('{');
      const firstBracket = t.indexOf('[');
      const start = (firstBracket !== -1 && firstBracket < firstBrace) || firstBrace === -1 ? t.indexOf('[') : firstBrace;
      const lastBrace = t.lastIndexOf('}');
      const lastBracket = t.lastIndexOf(']');
      const end = (lastBracket > lastBrace) ? lastBracket : lastBrace;
      if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1).trim();
      t = t.replace(/,\s*([\]}])/g, '$1');
      return t;
    }

    const MAX_SRC = 4000;
    const clipped = (pageSrc || '').slice(0, MAX_SRC);
    const prompt =
`We are examining a page:

${clipped}
---

We have extracted deadline-like snippets and need to convert them to concrete datetimes.

NOW
- Current instant (ISO 8601): ${nowCtx.now_iso}
- Time zone (IANA): ${nowCtx.tz}

TASK
For EACH input snippet, return an array of objects, each with this EXACT shape:

[
  { "original": string, "label": ${JSON.stringify(DEADLINE_TYPES)}, "when_iso": string|null, "confidence": number }
]

RULES
- Interpret relative phrases from NOW (e.g., "in 6 days 20 hours").
- If no explicit time, default to 12:00 PM (noon) local time for day-level deadlines.
- If it's a countdown, compute absolute when_iso.
- Output STRICT JSON only.

SNIPPETS:
${JSON.stringify(snippets, null, 2)}
`;

    const raw = await this.session.prompt(prompt);
    const cleaned = cleanJsonOutputStrict(raw);
    try { return JSON.parse(cleaned); } catch { return null; }
  }

  private makeExtractPrompt(src: string): string {
    return `ROLE
You are an extraction assistant helping extract the data of a potential contract/gig the user is considering (job post, RFP, tender, project brief) from the page where the data is published.

GOAL
From THIS SINGLE PAGE, return only the BASIC contract/gig FIELDS that are directly observable in the page content.
If something is not clearly present, set it to null (or []).

TERMS & DISAMBIGUATION
- "title" = the posting’s headline/title (e.g., "Convert Designs to HTML").
- "client" = the buyer/org/company posting the contract/gig (if named).
- "skills" = must-have capabilities mentioned (normalize to lowercase tokens). No guessing.
- "compensation" = what the page says about pay. Preserve the original wording in "text".
  • "type": "fixed" if one-off amount/budget, "hourly" if per hour/day, else null.
  • "text": exact pay string as shown, or null.
- "post_date_raw" = any visible "posted/updated" text as-is.
- "deliverables" = explicitly enumerated outputs.
- "deadlines_raw" = raw date/time snippets found in the text.
- "contacts" = only plainly visible page contacts.
- "description_summary" = a brief of the contract/gig.
- "posting_notes" = other details.

OUTPUT strict JSON:
{
  "title": string|null,
  "client": string|null,
  "location": string|null,
  "description_summary": string|null,
  "skills": string[],
  "compensation": { "type": "fixed"|"hourly"|null, "text": string|null },
  "post_date_raw": string|null,
  "deliverables": string[],
  "deadlines_raw": string[],
  "contacts": [ { "name": string|null, "role": string|null, "email": string|null, "phone": string|null, "source": "page" } ],
  "posting_notes": string|null
}

SOURCE (truncated):
${src}`;
  }

  // ---- Render (lean MUI; no giant slab) ------------------------------
// ---- Render (compact, dialog-like rhythm) ------------------------------
  public render(): React.ReactNode {
    const s = this.state;

    return React.createElement(ThemeProvider as any, { theme: compactTheme },
      React.createElement(Stack, { spacing: 2, sx: { p: 1.5 } },

        // Actions row
        React.createElement(Stack, { direction: 'row', spacing: 1, alignItems: 'center' },
          React.createElement(Button, { variant: 'contained', size: 'small', onClick: this.onCapture }, 'Start a new Capture'),
          React.createElement(Button, { variant: 'contained', color:"error", size: 'small', disabled: !s.canSave, onClick: this.onSave }, 'Save to Pipeline'),
          React.createElement(Typography, { variant: 'caption', sx: { ml: 1 } }, s.status || '\u00A0')
        ),

        React.createElement(Divider, null),
        React.createElement(Box, {
          sx: {
            position: 'relative',
            // visual: optional subtle dim behind blur
            '&::after': s.formLocked ? {
              content: '""',
              position: 'absolute',
              inset: 0,
              bgcolor: 'transparent',
            } : undefined,
          }
        },
          // Content that gets blurred/disabled
          React.createElement(Box, {
            sx: {
              filter: s.formLocked ? 'blur(2px)' : 'none',        // nice-to-have blur
              pointerEvents: s.formLocked ? 'none' : 'auto',       // block interactions
              userSelect: s.formLocked ? 'none' : 'auto',
              transition: 'filter 200ms ease',
            }
          },
            // Two-column form
            React.createElement(Grid, { container: true, spacing: 2 },
              // Left column
              React.createElement(Grid, { item: true, xs: 12, md: 6 },
                React.createElement(Stack, { spacing: 2 },
                  React.createElement(TextField, { label: 'Title', fullWidth: true, size: 'small', value: s.title, onChange: this.handleStr('title') }),
                  React.createElement(TextField, { label: 'Client', fullWidth: true, size: 'small', value: s.company, onChange: this.handleStr('company') }),
                  React.createElement(TextField, { label: 'Location', fullWidth: true, size: 'small', value: s.location, onChange: this.handleStr('location') }),
                  React.createElement(TextField, { label: 'Summary', fullWidth: true, size: 'small', multiline: true, minRows: 4, value: s.summary, onChange: this.handleStr('summary') }),
                  React.createElement(FormControl, { fullWidth: true, size: 'small' },
                    React.createElement(InputLabel, {}, 'Stage'),
                    React.createElement(Select, {
                      label: 'Type',
                      value: s.funnelStage || '',
                      onChange: this.handleSelectStage.bind(this)
                    },
                      OPPORTUNITY_STAGES.map(function (st) {
                        return React.createElement(MenuItem, { key: st, value: st }, st);
                      })
                    )
                  ),
                )
              ),
              // Right column
              React.createElement(Grid, { item: true, xs: 12, md: 6 },
                React.createElement(Stack, { spacing: 2 },
                  React.createElement(TextField, {
                    label: 'Skills',
                    placeholder: 'comma,separated,skills',
                    fullWidth: true,
                    size: 'small',
                    multiline: true,
                    minRows: 3,
                    value: s.skillsCSV,
                    onChange: this.handleStr('skillsCSV')
                  }),

                  React.createElement(TextField, {
                    label: 'Deliverables',
                    placeholder: 'one per line',
                    fullWidth: true,
                    size: 'small',
                    multiline: true,
                    minRows: 3,
                    value: s.deliverablesText,
                    onChange: this.handleStr('deliverablesText')
                  }),

                  React.createElement(TextField, { label: 'Notes', fullWidth: true, size: 'small', value: s.postNotes, onChange: this.handleStr('postNotes') }),

                  React.createElement(TextField, {
                    label: 'Compensation Type',
                    placeholder: 'fixed | hourly | retainer | ...',
                    fullWidth: true,
                    size: 'small',
                    value: s.compType || '',
                    onChange: this.handleStr('compType')
                  }),
                  React.createElement(TextField, {
                    label: 'Compensation Text',
                    fullWidth: true,
                    size: 'small',
                    value: s.compText,
                    onChange: this.handleStr('compText')
                  }),
                )
              )
            ),
            // Deadlines
            React.createElement(Stack, { spacing: 1 },
              this.renderDeadlines()
            ),
            // Contacts
            React.createElement(Stack, { spacing: 1 },
              this.renderContacts()
            ),
          )
        ),

        React.createElement(
          Backdrop,
          { open: this.state.busy, sx: { color: '#fff', mt:"0px !important", zIndex: function (t: any) { return t.zIndex.drawer + 1; } } },
          React.createElement(CircularProgress, { color: 'inherit' })
        )
      )
    );
  }


  // ---- Tiny render helpers (still no arrows) --------------------------
  private handleStr(field: keyof State): (e: any) => void {
    const self = this;
    return function (e: any) {
      const v = typeof e?.target?.value === 'string' ? e.target.value : '';
      const patch: any = {}; patch[field] = v;
      self.setState(patch);
    };
  }
  private handleSelectStage(e: any): void {
    const v = (e?.target?.value || 'examining') as OpportunityStage;
    this.setState({ funnelStage: v });
  }
  private renderDeadlines(): React.ReactNode {
    const self = this;
    return React.createElement(Box, { sx: { p: 1 } },
      React.createElement(Box, { sx: { display: 'flex', justifyContent: 'flex-start' } },
        React.createElement(Typography, { variant: 'subtitle2', sx:{mt:"4px"} }, 'Deadlines'),
        React.createElement(Button, { size: 'small', startIcon: React.createElement(AddIcon), onClick: this.addDeadline }, "Add")
      ),
        React.createElement(Box, { sx: { maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto', pr: 1, mr: -1 } },
        this.state.deadlines.map(function (d, idx) {
          return React.createElement(Grid, { container: true, spacing: 1, alignItems: 'center', key: idx, sx: { mt: 1 } },
            React.createElement(Grid, { item: true, xs: 12, md: 4 },
              React.createElement(TextField, {
                type: 'datetime-local',
                variant: 'outlined',
                label: undefined,
                InputProps: { notched: false },
                fullWidth: true,
                value: isoToLocalInput(d.when_iso),
                sx: {
                  '& .MuiOutlinedInput-notchedOutline legend': { width: 0 }, // collapse notch
                },
                onChange: function (e: any) {
                  const val = localInputToIso(e.target.value);
                  self.updateDeadline(idx, { when_iso: val });
                }
              })
            ),
            React.createElement(Grid, { item: true, xs: 12, md: 3 },
              React.createElement(FormControl, { fullWidth: true },
                React.createElement(InputLabel, {}, 'Type'),
                React.createElement(Select, {
                  label: 'Type',
                  value: DEADLINE_TYPES.indexOf(d.label) >= 0 ? d.label : 'other',
                  onChange: function (e: any) { self.updateDeadline(idx, { label: e.target.value }); }
                },
                  DEADLINE_TYPES.map(function (t) {
                    return React.createElement(MenuItem, { key: t, value: t }, t);
                  })
                )
              )
            ),
            React.createElement(Grid, { item: true, xs: 12, md: 4 },
              React.createElement(TextField, {
                label: 'Description',
                fullWidth: true,
                value: d.original || '',
                onChange: function (e: any) { self.updateDeadline(idx, { original: e.target.value }); }
              })
            ),
            React.createElement(Grid, { item: true, xs: 12, md: 1, sx: { textAlign: 'right' } },
              React.createElement(IconButton, { onClick: function () { self.removeDeadline(idx); }, size: 'small' },
                React.createElement(DeleteIcon, null)
              )
            )
          );
        })
      )
    );
  }

  private addDeadline(): void {
    const arr = this.state.deadlines.slice();
    arr.push({ original: '', label: 'other', when_iso: null, confidence: 0 });
    this.setState({ deadlines: arr });
  }
  private removeDeadline(idx: number): void {
    const arr = this.state.deadlines.slice();
    arr.splice(idx, 1);
    this.setState({ deadlines: arr });
  }
  private updateDeadline(idx: number, patch: Partial<DeadlineItem>): void {
    const arr = this.state.deadlines.slice();
    arr[idx] = Object.assign({}, arr[idx], patch);
    this.setState({ deadlines: arr });
  }

  private renderContacts(): React.ReactNode {
    const self = this;
    return React.createElement(Box, { sx: { p: 1 } },
      React.createElement(Box, { sx: { display: 'flex', justifyContent: 'flex-start' } },
        React.createElement(Typography, { variant: 'subtitle2', sx:{mt:"4px"} }, 'Contacts'),
        React.createElement(Button, { size: 'small', startIcon: React.createElement(AddIcon), onClick: this.addContact }, "Add")
      ),
      React.createElement(Box, { sx: { maxHeight: LIST_MAX_HEIGHT, overflowY: 'auto', pr: 1, mr: -1 } },
        this.state.contacts.map(function (c, idx) {
          return React.createElement(Grid, { container: true, spacing: 1, alignItems: 'center', key: idx, sx: { mt: 1 } },
            React.createElement(Grid, { item: true, xs: 12, md: 3 },
              React.createElement(TextField, { label: 'Name', fullWidth: true, value: c.name, onChange: function (e: any) { self.updateContact(idx, { name: e.target.value }); } })
            ),
            React.createElement(Grid, { item: true, xs: 12, md: 3 },
              React.createElement(TextField, { label: 'Role', fullWidth: true, value: c.role, onChange: function (e: any) { self.updateContact(idx, { role: e.target.value }); } })
            ),
            React.createElement(Grid, { item: true, xs: 12, md: 3 },
              React.createElement(TextField, { label: 'Email', fullWidth: true, value: c.email, onChange: function (e: any) { self.updateContact(idx, { email: e.target.value }); } })
            ),
            React.createElement(Grid, { item: true, xs: 12, md: 2 },
              React.createElement(TextField, { label: 'Phone', fullWidth: true, value: c.phone, onChange: function (e: any) { self.updateContact(idx, { phone: e.target.value }); } })
            ),
            React.createElement(Grid, { item: true, xs: 12, md: 1, sx: { textAlign: 'right' } },
              React.createElement(IconButton, { onClick: function () { self.removeContact(idx); }, size: 'small' },
                React.createElement(DeleteIcon, null)
              )
            )
          );
        })
      )
    );
  }

  private addContact(): void {
    const arr = this.state.contacts.slice();
    arr.push({ name: '', role: '', email: '', phone: '', source: 'page' });
    this.setState({ contacts: arr });
  }
  private removeContact(idx: number): void {
    const arr = this.state.contacts.slice();
    arr.splice(idx, 1);
    this.setState({ contacts: arr });
  }
  private updateContact(idx: number, patch: Partial<Contact>): void {
    const arr = this.state.contacts.slice();
    arr[idx] = normalizeContact(Object.assign({}, arr[idx], patch));
    this.setState({ contacts: arr });
  }
}

// ---- Mount API (called from panel.js) --------------------------------
export function initCapture(rootSelector: string, deps: Props): void {
  const el = document.querySelector(rootSelector) as HTMLElement;
  const root = ReactDOM.createRoot(el);
  root.render(React.createElement(CaptureApp, deps));
}
