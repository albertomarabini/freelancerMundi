// EventEditorDialog.tsx
import * as React from 'react';
import { useMemo, useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import DeleteIcon from '@mui/icons-material/Delete';
import Autocomplete from '@mui/material/Autocomplete';
import FormGroup from '@mui/material/FormGroup';
import ToggleButton from '@mui/material/ToggleButton';
import type {
  CalEvt,
  CalendarMeta,
  AdvancedOpts,
  Transparency,
  Visibility,
  Importance
} from '../types/interfaces';
import { ThemeProvider } from '@mui/material/styles';
import { compactTheme } from '../theme/compactTheme';

// keep in sync with your existing labels
const IMPORTANCE_LABELS = ['other','submission','delivery','milestone','meeting'] as const;

export type EventEditorMode = 'create' | 'edit';

export type EventEditorValues = {
  // common fields
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  calendarId: string;
  desc?: string;
  recurrenceRRULE?: string;            // single RRULE string (without "RRULE:")
  recurrence?: string[];               // explicit Google array (optional)
  attendees: string[];
  reminderString?: string;             // user input like "15m", "2h" or "" (blank = default)
  reminders?: string[];
  addMeet?: boolean;
  location?: string;
  visibility?: Visibility;
  transparency?: Transparency;
  importance?: Importance | '' | 'other';
};

export type EventEditorDialogProps = {
  open: boolean;
  mode: EventEditorMode;
  event?: CalEvt | null;               // when editing
  calendars: CalendarMeta[];
  defaultCalendarId: string;
  getTimeZone?: (calId?: string) => string | undefined;

  // Called when the user presses Save/Create. You decide how to persist.
  onSave: (values: EventEditorValues) => Promise<void> | void;

  // Only shown in edit mode. Use to trigger “this”, “all”, “this&future”.
  onDelete?: (scope: 'this' | 'all' | 'future') => Promise<void> | void;

  onClose: () => void;
};

// ----- UX presets -----
const RECURRENCE_PRESETS = [
  { key: '',         label: 'None',     rrule: '' },
  { key: 'DAILY',    label: 'Daily',    rrule: 'FREQ=DAILY' },
  { key: 'WEEKLY',   label: 'Weekly',   rrule: 'FREQ=WEEKLY' },
  { key: 'MONTHLY',  label: 'Monthly',  rrule: 'FREQ=MONTHLY' },
  { key: 'ADVANCED', label: 'Advanced (custom RRULE)…', rrule: '__ADVANCED__' },
];
const REMINDER_PRESETS = ['5m','10m','15m','30m','1h','2h','1d'] as const;

// ---------- helpers ----------
const isRecurring = (ev?: CalEvt | null) =>!!(ev?.recurrence && ev.recurrence.length > 0);
function minutesToToken(mins: number): string {
  if (mins % 10080 === 0) return (mins/10080)+'w';
  if (mins % 1440 === 0)  return (mins/1440)+'d';
  if (mins % 60 === 0)    return (mins/60)+'h';
  return mins+'m';
}
function parseByDayFromRRULE(rrule: string): string[] {
  const m = /BYDAY=([A-Z,]+)/.exec(rrule || '');
  return m ? m[1].split(',') : [];
}
function pad2(n: number) { return n < 10 ? '0' + n : '' + n; }
function toInputLocal(dt: Date) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}T${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}
function fromInputLocal(s: string) { return new Date(s); }

function atMidnightLocal(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0); }
function normalizeTimes(isAllDay: boolean, start: Date, end: Date) {
  if (end < start) [start, end] = [end, start];
  if (!isAllDay) return { start, end };
  const s = atMidnightLocal(start);
  const e = atMidnightLocal(end);
  return (e <= s)
    ? { start: s, end: new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1) }
    : { start: s, end: e };
}

function parseReminderToMinutes(s: string): number | null {
  const m = (s || '').trim().toLowerCase();
  if (m === '') return null;                 // “default”
  if (/^\d+$/.test(m)) return Math.max(0, parseInt(m, 10));
  const mm = m.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks)$/);
  if (!mm) return null;
  const n = parseInt(mm[1],10);
  const unit = mm[2][0]; // m/h/d/wk
  const mult = unit==='m' ? 1 : unit==='h' ? 60 : unit==='d' ? 1440 : 10080;
  return Math.max(0, n * mult);
}

function readOptyAnchor():
  | { optyId: string; meta?: any; focusDate?: Date | null }
  | null {
  try {
    // Prefer explicit getter if calendar exposed it; otherwise we can’t read internals
    return window.CalendarUI?.getAnchor ? window.CalendarUI.getAnchor() : null;
  } catch { return null; }
}

function getEventOptyId(ev?: CalEvt | null): string | null {
  try {
    return (
      (ev as any)?.extended?.private?.opty_id ??
      (ev as any)?.extended?.shared?.opty_id ??
      null
    ) ? String(
      (ev as any)?.extended?.private?.opty_id ??
      (ev as any)?.extended?.shared?.opty_id
    ) : null;
  } catch { return null; }
}

// ---------- component ----------
export default function EventEditorDialog(props: EventEditorDialogProps) {
  const { open, mode, event, calendars, defaultCalendarId, onClose, onSave, onDelete } = props;
  // Anchored gig (read-only display here)
  const [anchor, setAnchor] = useState(readOptyAnchor());
  useEffect(() => { setAnchor(readOptyAnchor()); }, [open]);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setAnchor(readOptyAnchor()), 1000);
    return () => clearInterval(id);
  }, [open]);

  // Show the banner if:
  // - creating and there's an anchor, or
  // - editing and the event is linked to the anchored opty
  const isEditAttached = React.useMemo(() => {
    if (mode !== 'edit') return false;
    if (!anchor?.optyId || !event) return false;
    const evOptyId = getEventOptyId(event);
    return !!evOptyId && String(evOptyId) === String(anchor.optyId);
  }, [mode, event, anchor]);

  const shouldShowBanner = (mode === 'create' && !!anchor) || (mode === 'edit' && isEditAttached);

  const writable = useMemo(
    () => calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer'),
    [calendars]
  );

  // seed defaults
  const init = useMemo(() => {
    const now = new Date();
    const start = event?.start ? new Date(event.start) : new Date(now);
    const end   = event?.end   ? new Date(event.end)   : new Date(start.getTime() + 30*60*1000);
    return {
      title: event?.title || '',
      desc: event?.desc || '',
      start,
      end,
      isAllDay: !!event?.allDay,
      calendarId: event?.calendarId || defaultCalendarId,
      attendees: (event?.attendees || []) as string[],
      recurrenceRRULE: undefined as string | undefined,
      recurrence: undefined as string[] | undefined,
      // legacy first reminder for compatibility
      reminderString: (function () {
        const r = (event as any)?.reminders;
        if (!r || r.useDefault) return '';
        const first = r.overrides?.find((o:any)=>o.method==='popup');
        return (first && typeof first.minutes === 'number') ? String(first.minutes) : '';
      })(),
      // multi-reminders (tokens)
      reminders: (function () {
        const r = (event as any)?.reminders;
        if (!r || r.useDefault) return [];
        const mins = (r.overrides || [])
          .filter((o:any)=>o.method==='popup' && typeof o.minutes==='number')
          .map((o:any)=> minutesToToken(o.minutes));
        return Array.from(new Set(mins));
      })(),
      addMeet: !!(event && (event as any).meetUrl),
      location: event?.location || '',
      visibility: event?.visibility || 'default',
      transparency: event?.transparency || 'opaque',
      importance: (event?.importance || '') as any,
    } as EventEditorValues;
  }, [event, defaultCalendarId]);

  const [vals, setVals] = useState<EventEditorValues>(init);
  const [attInput, setAttInput] = useState('');
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const tokenize = (s: string) => s.split(/[, \n\r\t]+/).map(x => x.trim()).filter(Boolean);
  // derive presets state from initial values
  const initialRRule = init.recurrenceRRULE || (event?.recurrence?.find(r => r.startsWith('RRULE:'))?.slice(6) || '');
  const [recurrencePreset, setRecurrencePreset] = useState<string>(
    RECURRENCE_PRESETS.find(p => p.rrule && initialRRule.startsWith(p.rrule))?.key || (initialRRule ? 'ADVANCED' : '')
  );
  const [advancedRRULE, setAdvancedRRULE] = useState<string>(recurrencePreset === 'ADVANCED' ? initialRRule : '');
  // weekly day-of-week selection (MO..SU)
  const DOW = ['SU','MO','TU','WE','TH','FR','SA'] as const;
  const startDowIdx = (event?.start ? new Date(event.start) : new Date()).getDay(); // 0=Sun
  const initialByDay = useMemo(() => {
    if (initialRRule && /FREQ=WEEKLY/.test(initialRRule)) return parseByDayFromRRULE(initialRRule);
    // default preselect same day as start
    return [DOW[startDowIdx]];
  }, [initialRRule, startDowIdx]);
  const [weeklyByDay, setWeeklyByDay] = useState<string[]>(initialByDay);
  // monthly same day (BYMONTHDAY = day of start)
  const monthDay = (event?.start ? new Date(event.start) : new Date()).getDate();
  // multi reminders (tokens)
  const [reminderTokens, setReminderTokens] = useState<string[]>(init.reminders || []);

  useEffect(() => { setVals(init); setAttInput(''); }, [init, open]);
  useEffect(() => {
      if (recurrencePreset === 'WEEKLY' && weeklyByDay.length === 0) setWeeklyByDay([DOW[startDowIdx]]);
  }, [recurrencePreset, startDowIdx, weeklyByDay.length]);
  const set = <K extends keyof EventEditorValues>(k: K, v: EventEditorValues[K]) =>
    setVals(prev => ({ ...prev, [k]: v }));

  const commitTokens = (raw: string) => {
      const tokens = tokenize(raw).filter(t => emailRe.test(t));
      if (!tokens.length) return;
      setVals(prev => ({ ...prev, attendees: Array.from(new Set([...prev.attendees, ...tokens])) }));
  };
  const handleRemoveAttendee = (email: string) =>
    setVals(prev => ({ ...prev, attendees: prev.attendees.filter(a => a !== email) }));

  const handleSave = async () => {
    // map recurrence preset → rrule string
    let rruleOut = '';
    if (recurrencePreset === 'ADVANCED') {
      rruleOut = (advancedRRULE || '').trim();
    } else if (recurrencePreset === 'DAILY') {
        rruleOut = 'FREQ=DAILY';
    } else if (recurrencePreset === 'WEEKLY') {
      const by = (weeklyByDay && weeklyByDay.length) ? `;BYDAY=${weeklyByDay.join(',')}` : `;BYDAY=${DOW[startDowIdx]}`;
      rruleOut = `FREQ=WEEKLY${by}`;
    } else if (recurrencePreset === 'MONTHLY') {
      rruleOut = `FREQ=MONTHLY;BYMONTHDAY=${monthDay}`;
    } else {
      rruleOut = '';
    }
    // reminders (multi)
    const cleanedReminders = Array.from(new Set(
      (reminderTokens || [])
        .map(t => t.trim().toLowerCase())
        .filter(t => !!parseReminderToMinutes(t))
    ));
    // legacy first reminder for backward compat
    const legacyFirst = cleanedReminders.length
      ? String(parseReminderToMinutes(cleanedReminders[0]) || '')
      : '';
    // normalize times and map reminder string
    const { start, end } = normalizeTimes(vals.isAllDay, vals.start, vals.end);
    const out: EventEditorValues = {
      ...vals,
      start, end,
      recurrenceRRULE: rruleOut || undefined,
      // legacy single ("" => default)
      reminderString: legacyFirst,
      // multi list
      reminders: cleanedReminders
    };
    await onSave(out);
  };

  const showDelete = mode === 'edit' && !!onDelete;
  const showMultiDelete = showDelete && isRecurring(event);
  const showSingleDelete = showDelete && !isRecurring(event);

  return (
    <ThemeProvider theme={compactTheme}>
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{mode === 'edit' ? 'Edit Event' : 'New Event'}</DialogTitle>
      {/* Attached gig banner (shown only when anchored) */}
      {shouldShowBanner ? (
        <Box
          sx={{
            display:'flex',
            alignItems:'center',
            justifyContent:'space-between',
            p:1,
            borderRadius:1,
            bgcolor:'#FFF8E1',
            border:'1px solid #FFE082'
          }}
        >
          <Typography variant="body2" sx={{ mr:2 }}>
            Attached to gig:&nbsp;
            <strong>{anchor?.meta?.title || 'Untitled'}</strong>
            {anchor?.meta?.company ? <> · {anchor?.meta.company}</> : null}
          </Typography>
          <Box sx={{ display:'flex', gap:1 }}>
            {/* Optional: quick link to the original posting if present */}
            {anchor?.meta?.url ? (
              <Button
                size="small"
                component="a"
                href={anchor.meta.url}
                target="_blank"
                rel="noreferrer"
              >
                Open link
              </Button>
            ) : null}
            <Button
              size="small"
              onClick={() => {
                try { window.CalendarUI?.clearAnchor?.(); } catch {}
              }}
            >
              Remove
            </Button>
          </Box>
        </Box>
      ) : null}
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Title"
            value={vals.title}
            onChange={e => set('title', e.target.value)}
            autoFocus
            fullWidth
          />

          <Stack direction="row" spacing={2}>
            <TextField
              label="Start"
              type="datetime-local"
              value={toInputLocal(vals.start)}
              onChange={e => set('start', fromInputLocal(e.target.value))}
              fullWidth
              InputLabelProps={{ shrink: true }}
              disabled={vals.isAllDay}
            />
            <TextField
              label="End"
              type="datetime-local"
              value={toInputLocal(vals.end)}
              onChange={e => set('end', fromInputLocal(e.target.value))}
              fullWidth
              InputLabelProps={{ shrink: true }}
              disabled={vals.isAllDay}
            />
          </Stack>

          <FormControlLabel
            control={
              <Checkbox
                checked={vals.isAllDay}
                onChange={e => set('isAllDay', e.target.checked)}
              />
            }
            label="All-day"
          />

          <Stack direction="row" spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="cal-sel">Calendar</InputLabel>
              <Select
                labelId="cal-sel"
                label="Calendar"
                value={vals.calendarId}
                onChange={e => set('calendarId', e.target.value as string)}
              >
                {writable.map(c =>
                  <MenuItem key={c.id} value={c.id}>{c.summary}{c.primary ? ' (primary)':''}</MenuItem>
                )}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="importance-sel">Event Type</InputLabel>
              <Select
                labelId="importance-sel"
                label="Event Type"
                value={vals.importance || ''}
                onChange={e => set('importance', e.target.value as any)}
              >
                <MenuItem value=""><em>none</em></MenuItem>
                {IMPORTANCE_LABELS.map(l =>
                  <MenuItem key={l} value={l}>{l.charAt(0).toUpperCase()+l.slice(1)}</MenuItem>
                )}
              </Select>
            </FormControl>
          </Stack>

          <TextField
            label="Notes"
            value={vals.desc || ''}
            onChange={e => set('desc', e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />

          <Stack direction="row" spacing={2}>
          {/* Recurrence preset + advanced */}
            <FormControl fullWidth sx={{ flex: 1, minWidth: 0 }}>
              <InputLabel id="recurrence-preset">Recurrence</InputLabel>
              <Select
                labelId="recurrence-preset"
                label="Recurrence"
                value={recurrencePreset}
                onChange={e => {
                  const v = e.target.value as string;
                  setRecurrencePreset(v);
                  if (v !== 'ADVANCED') setAdvancedRRULE('');
                }}
              >
                {RECURRENCE_PRESETS.map(p => (
                  <MenuItem key={p.key} value={p.key}>{p.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {/* Multiple reminders */}
            <Autocomplete
              multiple
              freeSolo
              options={REMINDER_PRESETS as readonly string[]}
              value={reminderTokens}
              sx={{ flex: 1, minWidth: 0 }}
              onChange={(_e, newValue) => {
                // accept only valid tokens we can parse to minutes
                const cleaned = Array.from(new Set(
                  (newValue as string[]).map(v => v.trim().toLowerCase()).filter(v => !!parseReminderToMinutes(v))
                ));
                setReminderTokens(cleaned);
              }}
              renderTags={(value, getTagProps) =>
                value.map((option, index) => (
                  <Chip {...getTagProps({ index })} key={option} size="small" label={option} />
                ))
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Reminders"
                  placeholder="Add reminders (e.g., 10m, 1h, 1d). Empty = default."
                />
              )}
            />
          </Stack>
          {/* Weekly day picker */}
                    {/* Weekly day picker (compact, inline with label) */}
          {recurrencePreset === 'WEEKLY' && (
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="body2" sx={{ whiteSpace: 'nowrap' }}>Repeat on</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(['SU','MO','TU','WE','TH','FR','SA'] as const).map(code => {
                  const label = {SU:'Sun',MO:'Mon',TU:'Tue',WE:'Wed',TH:'Thu',FR:'Fri',SA:'Sat'}[code];
                  const selected = weeklyByDay.includes(code);
                  return (
                    <ToggleButton
                      key={code}
                      value={code}
                      selected={selected}
                      onChange={() => {
                        setWeeklyByDay(prev => selected ? prev.filter(d => d!==code) : [...prev, code]);
                      }}
                      sx={{
                        p: 0,
                        px: 0.5,
                        minWidth: 34,
                        height: 28,
                        lineHeight: 1,
                        borderRadius: 1
                      }}
                    >
                      {label}
                    </ToggleButton>
                  );
                })}
              </Box>
            </Stack>
          )}
          {/* Advanced RRULE text */}
          {recurrencePreset === 'ADVANCED' && (
            <TextField
              label="Custom RRULE"
              placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
              value={advancedRRULE}
              onChange={e => setAdvancedRRULE(e.target.value)}
              fullWidth
            />
          )}
          <Stack direction="row" spacing={2}>
            <FormControl fullWidth>
              <InputLabel id="vis-sel">Visibility</InputLabel>
              <Select
                labelId="vis-sel"
                label="Visibility"
                value={vals.visibility || 'default'}
                onChange={e => set('visibility', e.target.value as Visibility)}
              >
                <MenuItem value="default">default</MenuItem>
                <MenuItem value="public">public</MenuItem>
                <MenuItem value="private">private</MenuItem>
                <MenuItem value="confidential">confidential</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="trans-sel">Busy/Free</InputLabel>
              <Select
                labelId="trans-sel"
                label="Busy/Free"
                value={vals.transparency || 'opaque'}
                onChange={e => set('transparency', e.target.value as Transparency)}
              >
                <MenuItem value="opaque">busy</MenuItem>
                <MenuItem value="transparent">free</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <TextField
            label="Location"
            value={vals.location || ''}
            onChange={e => set('location', e.target.value)}
            fullWidth
          />

          <FormControlLabel
            control={<Checkbox checked={!!vals.addMeet} onChange={e => set('addMeet', e.target.checked)} />}
            label="Create Meet link"
          />

          <Divider />

                    <Typography variant="subtitle2">Attendees</Typography>
          {/* Single control: chips + input share the same field; bounded height with scroll */}
          <Autocomplete
            multiple
            freeSolo
            options={[] as string[]}
            value={vals.attendees}
            onChange={(_e, newValue) => {
              //Value may contain arbitrary strings; filter to valid emails and dedupe
              const cleaned = Array.from(new Set(newValue.filter(v => emailRe.test(String(v)))));
              set('attendees', cleaned as string[]);
            }}
            inputValue={attInput}
            onInputChange={(_e, newVal, reason) => {
              // when user types delimiters, tokenize immediately
              if (/[,\n\t ]/.test(newVal)) {
                commitTokens(newVal);
                setAttInput('');
              } else if (reason === 'input') {
                setAttInput(newVal);
              }
            }}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip {...getTagProps({ index })} key={option} size="small" label={option} />
              ))
            }
            renderInput={(params) => (
              <TextField
                {...params}
                placeholder="Type email(s). Enter to add; paste comma/space/newline-separated."
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitTokens(attInput); setAttInput(''); } }}
                onPaste={(e) => { const t = e.clipboardData?.getData('text') || ''; if (/[,\n\t ]/.test(t)) { e.preventDefault(); commitTokens(t); } }}
              />
            )}
            sx={{ '& .MuiInputBase-root': { alignItems: 'flex-start', maxHeight: 120, overflowY: 'auto', pt: 1, pb: 1 } }}
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        {/* recurring → show the 3 scopes on the left */}
        {showMultiDelete && (
          <Box sx={{ mr: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button startIcon={<DeleteIcon />} color="error" variant="contained" size="large" onClick={() => onDelete?.('this')}>
              Delete this
            </Button>
            <Button color="error" onClick={() => onDelete?.('future')}>This & future</Button>
            <Button color="error" variant="outlined" onClick={() => onDelete?.('all')}>Delete all</Button>
          </Box>
        )}

        {/* single-instance → one button on the left */}
        {showSingleDelete && (
          <Box sx={{ mr: 'auto', display: 'flex', alignItems: 'center' }}>
          <Button startIcon={<DeleteIcon />} color="error" variant="contained" size="large" onClick={() => onDelete?.('this')}>
            Delete
          </Button>
          </Box>
        )}

        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>
          {mode === 'edit' ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
    </ThemeProvider>
  );
}
