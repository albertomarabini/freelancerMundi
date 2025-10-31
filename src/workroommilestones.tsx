// src/WorkroomMilestones.tsx
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import { Box, Button, Grid, TextField, Typography, IconButton, Select, MenuItem, FormControl, InputLabel, Stack, Divider, Backdrop, CircularProgress } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { compactTheme } from './theme/compactTheme';
import { Opty, type Importance } from './types/interfaces'; // same union: 'submission'|'delivery'|'milestone'|'meeting'|'other'


export type WorkroomMilestonesProps = { row: Opty, onClose?(): void};

declare const LanguageModel: {
  availability(): Promise<'available'|'unavailable'>;
  create(): Promise<{ prompt(q: string): Promise<string> }>;
};

type RawMilestone = { name: string|null; due_raw: string|null; original_html?: string|null };
type MsItem = { original: string; label: Importance; when_iso: string|null; confidence: number; name: string };

const DEADLINE_TYPES: Importance[] = ['submission','delivery','milestone','meeting','other'];
const LIST_MAX_HEIGHT = 120;

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
function cleanJsonOutputStrict(s: string): string {
  if (!s) return s;
  let t = s.trim();
  if (t.startsWith('```')) t = t.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  const fb = t.indexOf('{'), fbr = t.indexOf('[');
  const start = (fbr !== -1 && (fb === -1 || fbr < fb)) ? fbr : fb;
  const lb = t.lastIndexOf('}'), lbr = t.lastIndexOf(']');
  const end = (lbr > lb) ? lbr : lb;
  if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1).trim();
  t = t.replace(/,\s*([\]}])/g, '$1');
  return t;
}

async function ensureSession(): Promise<{ prompt(q: string): Promise<string> }> {
  const avail = await LanguageModel.availability();
  if (avail === 'unavailable') throw new Error('Local model unavailable.');
  return LanguageModel.create();
}

export class WorkroomMilestones extends React.Component<WorkroomMilestonesProps, {
  status: string;
  busy: boolean;
  url: string;
  client: string;
  statusText: string;
  milestones: MsItem[];
}> {
  private session: { prompt(q: string): Promise<string> } | null;

  public constructor(props: WorkroomMilestonesProps) {
    super(props);
    this.session = null;
    this.state = {
      status: '',
      busy: false,
      url: '',
      client: '',
      statusText: '',
      milestones: []
    };
    // explicit bindings to keep parity with your existing style
    this.onScan = this.onScan.bind(this);
    this.addMilestone = this.addMilestone.bind(this);
    this.removeMilestone = this.removeMilestone.bind(this);
    this.updateMilestone = this.updateMilestone.bind(this);
    this.onSave = this.onSave.bind(this);
  }

  private async onScan(): Promise<void> {
    this.setState({ busy: true, status: 'Scanning…' });
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab.');
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'page/MockMarket/extract_milestones' });
      if (!resp?.ok) throw new Error(resp?.error || 'Extraction failed');

      const data = resp.data as {
        url: string; client: string|null; status: string|null; milestones_raw: RawMilestone[]; now_iso: string; tz: string;
      };

      if (!this.session) this.session = await ensureSession();

      const normalized = await this.normalizeMilestones(data.milestones_raw || [], data.now_iso, data.tz);
      const msItems: MsItem[] = normalized.map(function (r, i) {
        const raw = (data.milestones_raw[i]?.due_raw || '') as string;
        const name = (data.milestones_raw[i]?.name || '') as string;
        return {
          original: name ? (name + (raw ? ' — ' + raw : '')) : (raw || ''),
          label: DEADLINE_TYPES.indexOf(r.label) >= 0 ? r.label : 'milestone',
          when_iso: r.when_iso || null,
          confidence: typeof r.confidence === 'number' ? r.confidence : 0,
          name: name || ''
        };
      });

      this.setState({
        status: '✅ Parsed milestones.',
        url: data.url || '',
        client: data.client || '',
        statusText: data.status || '',
        milestones: msItems
      });
    } catch (e: any) {
      this.setState({ status: '⚠️ ' + (e?.message || String(e)) });
    } finally {
      this.setState({ busy: false });
    }
  }

  private async normalizeMilestones(items: RawMilestone[], now_iso: string, tz: string): Promise<Array<{ label: Importance; when_iso: string|null; confidence: number }>> {
    if (!this.session) this.session = await ensureSession();
    const snippets = items.map(function (m) { return (m && m.due_raw) ? String(m.due_raw) : ''; });

    const prompt =
`We have milestone due date snippets and need concrete datetimes.

NOW
- ISO: ${now_iso}
- Time zone: ${tz}

RULES
- Interpret relative phrases from NOW.
- If only a date is provided (no time), default to 12:00 PM (noon) local time for day-level deadlines.
- Output STRICT JSON array with same order as input:
[
  { "when_iso": string|null }
]

INPUT:
${JSON.stringify(snippets, null, 2)}
`;
    const raw = await this.session.prompt(prompt);
    const cleaned = cleanJsonOutputStrict(raw);
    let out: any = null;
    try { out = JSON.parse(cleaned); } catch { out = null; }
    if (!Array.isArray(out)) out = [];
    // pad/shape
    while (out.length < snippets.length) out.push(null);
    return out.map(function (r) {
      return {
        label: 'milestone',
        when_iso: r && r.when_iso ? String(r.when_iso) : null
      };
    });
  }

  private async onSave(): Promise<void> {
    this.setState({ status: 'Saving…', busy: true });
    try {
      const calendarStore = (window as any).calendarStore  || null;
      const settings = (window as any).appSettings || null;
      const calId =
        (settings && settings.business_calendar) ||
        (calendarStore && (function () { try { return calendarStore.getActiveCalendarId(); } catch { return null; } }())) ||
        null;

      if (!calendarStore || !calId) {
        this.setState({ status: '⚠️ Calendar unavailable (no calendarStore/calId).' });
        return;
      }

      // optional: ensure connection
      try { if (calendarStore.connect) await calendarStore.connect(); } catch (e) {}
      let focusDate = new Date(8640000000000000);
      const created: Array<{ idx: number; eventId: string | null }> = [];
      for (let i = 0; i < this.state.milestones.length; i++) {
        const m = this.state.milestones[i];
        if (!m.when_iso) continue;

        const start = new Date(m.when_iso);
        const end = new Date(start.getTime() + 30 * 60 * 1000);
        if (start < focusDate) focusDate = start;

        // Title: prefer milestone name + client
        const titleBits: string[] = [];
        if (m.name) titleBits.push(m.name);
        if (m.name && this.state.client) titleBits.push('—');
        if (this.state.client) titleBits.push(this.state.client);
        const title = titleBits.join(' ') || 'Milestone';

        const desc = m.original;

        let evId: string | null = null;
        try {
            const ev = await calendarStore.createAdvanced(calId, title, start, end, desc, { isAllDay: false, importance: m.label});
            if (calendarStore.updateExtendedProps && ev?.id) {
              await calendarStore.updateExtendedProps(calId, ev.id!, { private: { opty_id: (this.props.row as Opty).opty_id } });
            }
        } catch (e) {
          // swallow per-item errors but continue
          console.error('Event create failed', e);
        }
        created.push({ idx: i, eventId: evId });
      }
      if (created.length === 0) {
        this.setState({ status: 'No events created (missing dates or calendar error).' });
      } else {
        this.setState({ busy: false });
        try {
            (window as any).panel?.anchorCalendarToOpty?.(this.props.row as Opty, focusDate || null);
            try { this.props.onClose?.(); } catch(e) {console.error("Error while ", e) }
          } catch(e) {console.error("Error while anchoring to the rest of the app", e) }
      }
    } catch (e: any) {
      this.setState({ status: '⚠️ ' + (e?.message || String(e)) });
    } finally {
      this.setState({ busy: false });
    }
  }


  // --------- tiny helpers ----------
  private addMilestone(): void {
    const arr = this.state.milestones.slice();
    arr.push({ original: '', label: 'milestone', when_iso: null, confidence: 0, name: '' });
    this.setState({ milestones: arr });
  }
  private removeMilestone(idx: number): void {
    const arr = this.state.milestones.slice();
    arr.splice(idx, 1);
    this.setState({ milestones: arr });
  }
  private updateMilestone(idx: number, patch: Partial<MsItem>): void {
    const arr = this.state.milestones.slice();
    arr[idx] = Object.assign({}, arr[idx], patch);
    this.setState({ milestones: arr });
  }

  public render(): React.ReactNode {
    const s = this.state;
    return React.createElement(ThemeProvider as any, { theme: compactTheme },
      React.createElement(Stack, { spacing: 2, sx: { p: 1.5 } },

        React.createElement(Stack, { direction: 'row', spacing: 1, alignItems: 'center' },
          React.createElement(Button, { variant: 'contained', size: 'small', onClick: this.onScan }, 'Scan Workroom'),
          React.createElement(Button, { variant: 'outlined', size: 'small', onClick: this.onSave }, 'Save (stub)'),
          React.createElement(Typography, { variant: 'caption', sx: { ml: 1 } }, s.status || '\u00A0')
        ),

        React.createElement(Divider, null),

        React.createElement(Box, null,
            React.createElement(Grid, { item: true, xs: 12, md: 6 },
              React.createElement(Stack, { spacing: 2 },
                React.createElement(Typography, { variant: 'subtitle2', sx: { mt: '4px' } }, 'Milestones'),
                React.createElement(Box, { sx: { overflowY: 'auto', pr: 1, mr: -1 } },
                  s.milestones.map((d, idx) =>
                    React.createElement(Grid, { container: true, spacing: 1, alignItems: 'center', key: idx, sx: { mt: 1 } },
                        React.createElement(Grid, { item: true, xs: 5, sm: 5, md: 4 },
                        React.createElement(TextField, {
                          type: 'datetime-local',
                          variant: 'outlined',
                          label: undefined,
                          InputProps: { notched: false },
                          fullWidth: true,
                          value: isoToLocalInput(d.when_iso),
                          sx: { '& .MuiOutlinedInput-notchedOutline legend': { width: 0 } },
                          onChange: (e: any) => this.updateMilestone(idx, { when_iso: localInputToIso(e.target.value) })
                        })
                      ),
                      React.createElement(Grid, { item: true, xs: 3, sm: 3, md: 3 },
                        React.createElement(FormControl, { fullWidth: true },
                          React.createElement(InputLabel, {}, 'Type'),
                          React.createElement(Select, {
                            label: 'Type',
                            value: DEADLINE_TYPES.indexOf(d.label) >= 0 ? d.label : 'milestone',
                            onChange: (e: any) => this.updateMilestone(idx, { label: e.target.value })
                          },
                            DEADLINE_TYPES.map(function (t) {
                              return React.createElement(MenuItem, { key: t, value: t }, t);
                            })
                          )
                        )
                      ),
                      React.createElement(Grid, { item: true, xs: 3, sm: 3, md: 4 },
                        React.createElement(TextField, {
                          label: 'Label',
                          fullWidth: true,
                          value: d.name || '',
                          onChange: (e: any) => this.updateMilestone(idx, { name: e.target.value })
                        })
                      ),
                      React.createElement(Grid, { item: true, xs: 1, sm: 1, md: 1, sx: { textAlign: 'right' } },
                        React.createElement(IconButton, { onClick: () => this.removeMilestone(idx), size: 'small' },
                          React.createElement(DeleteIcon, null)
                        )
                      ),
                    )
                  ),
                  React.createElement(Button, { size: 'small', startIcon: React.createElement(AddIcon), onClick: this.addMilestone, sx: { mt: 1 } }, "Add")
                )
              )
            )
        ),

        React.createElement(Backdrop, { open: s.busy, sx: { color: '#fff', zIndex: function (t: any) { return t.zIndex.drawer + 1; } } },
          React.createElement(CircularProgress, { color: 'inherit' })
        )
      )
    );
  }
}

// Helper to mount (optional, mirror your init)
export function initWorkroomMilestones(rootSelector: string, row:Opty): void {
  const el = document.querySelector(rootSelector) as HTMLElement;
  const root = ReactDOM.createRoot(el);
  root.render(React.createElement(WorkroomMilestones, {row}));
}
