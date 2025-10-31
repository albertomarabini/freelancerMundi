/* src/settings.tsx */
/// <reference types="chrome"/>

import * as React from 'react';
import { createRoot } from 'react-dom/client';

// MUI
import {
  Container, Box, Stack, Typography, FormControl, InputLabel, Select, MenuItem,
  Button, Alert, CircularProgress, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Divider, FormControlLabel, Switch
} from '@mui/material';
import Autocomplete from '@mui/material/Autocomplete';
import CheckIcon from '@mui/icons-material/Check';
import {GoogleCalendarClient} from './lib/gcal/GoogleCalendarClient'
import { CalendarMeta } from './types/interfaces';

// ---- background helpers (unchanged) ----
async function loadSettingsFromFirebase(): Promise<{ business_calendar: string | null }> {
  const res = await chrome.runtime.sendMessage({ type: 'settings/get' });
  if (!res?.ok) throw new Error(res?.error || 'settings/get failed');
  return res.data || { business_calendar: null };
}
async function saveSettingsToFirebase(data: { business_calendar: string | null }): Promise<void> {
  const res = await chrome.runtime.sendMessage({ type: 'settings/set', data });
  if (!res?.ok) throw new Error(res?.error || 'settings/set failed');
}
async function getAccessToken(): Promise<string> {
  const res = await chrome.runtime.sendMessage({ type: 'google/token' });
  if (!res?.ok) throw new Error(res?.error || 'No Google token');
  return res.access_token;
}

/** Punchy, safe colors (no pastels). */
const SAFE_COLORS = [
  '#d32f2f', '#c2185b', '#7b1fa2', '#512da8', '#303f9f',
  '#1976d2', '#0288d1', '#00796b', '#388e3c', '#689f38',
  '#f57c00', '#e64a19', '#455a64',
] as const;

function ColorSwatch({
  color, selected, onClick, label,
}: { color: string; selected?: boolean; onClick: () => void; label?: string }) {
  return (
    <Box
      onClick={onClick}
      title={label || color}
      sx={{
        width: 28, height: 28, borderRadius: '6px', cursor: 'pointer',
        border: '2px solid rgba(0,0,0,.2)',
        boxShadow: selected ? '0 0 0 2px rgba(0,0,0,.25)' : 'none',
        position: 'relative',
        backgroundColor: color,
      }}
    >
      {selected && (
        <CheckIcon
          sx={{
            position: 'absolute', right: -10, top: -10, fontSize: 18,
            color: 'rgba(0,0,0,.55)', background: '#fff', borderRadius: '50%',
          }}
        />
      )}
    </Box>
  );
}

function SettingsApp() {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [calendars, setCalendars] = React.useState<CalendarMeta[]>([]);
  const [selected, setSelected] = React.useState<string>('');

  // Create dialog state — full CreateCalendarInput
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState('');
  const [createTimeZone, setCreateTimeZone] = React.useState('');   // optional IANA TZ
  const [createDescription, setCreateDescription] = React.useState('');
  const [createLocation, setCreateLocation] = React.useState('');
  const [createColor, setCreateColor] = React.useState<string>(SAFE_COLORS[5]);
  const [createSelected, setCreateSelected] = React.useState(true);

  // Recolor dialog (existing calendar)
  const [recolorOpen, setRecolorOpen] = React.useState(false);
  const [recolorColor, setRecolorColor] = React.useState<string>(SAFE_COLORS[5]);

  // Lazy-loaded IANA tz list (Chrome trick) — only populate when dialog opens
  const [tzOptions, setTzOptions] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!createOpen || tzOptions.length) return;
    const anyIntl = Intl as any;
    if (typeof anyIntl.supportedValuesOf === 'function') {
      try {
        setTzOptions(anyIntl.supportedValuesOf('timeZone') || []);
      } catch {
        setTzOptions(['UTC','America/Los_Angeles','America/New_York','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney']);
      }
    } else {
      setTzOptions(['UTC','America/Los_Angeles','America/New_York','Europe/London','Europe/Paris','Asia/Tokyo','Australia/Sydney']);
    }
  }, [createOpen, tzOptions.length]);

  const gcal = React.useMemo(() => new GoogleCalendarClient(getAccessToken), []);

  async function refreshCalendars() {
    const list = await gcal.listCalendars();
    setCalendars(list);
    const sel = list.find(c => c.id === selected);
    if (sel?.bg) setRecolorColor(sel.bg);
    return list;
  }

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const s = await loadSettingsFromFirebase();
        setSelected(s.business_calendar || '');
        const list = await refreshCalendars();
        if (!s.business_calendar) {
          const primary = list.find(c => c.primary);
          if (primary) setSelected(primary.id);
        }
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      await saveSettingsToFirebase({ business_calendar: selected || null });
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
      (window as any).switchTab?.('calendar');
    }
  }

  async function handleCreateCalendar() {
    try {
      setSaving(true);
      setError(null);
      const name = (createName || '').trim();
      if (!name) return;

      const input = {
        summary: name,
        timeZone: createTimeZone.trim() || undefined,
        description: createDescription.trim() || undefined,
        location: createLocation.trim() || undefined,
        color: createColor,
        selected: createSelected,
      } as const;

      const meta = await gcal.createCalendar(input);
      await refreshCalendars();
      setSelected(meta.id);

      // reset dialog
      setCreateOpen(false);
      setCreateName('');
      setCreateTimeZone('');
      setCreateDescription('');
      setCreateLocation('');
      setCreateColor(SAFE_COLORS[5]);
      setCreateSelected(true);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyColorToExisting() {
    try {
      if (!selected) return;
      setSaving(true);
      setError(null);
      await gcal.setCalendarColor(selected, recolorColor);
      await refreshCalendars();
      setRecolorOpen(false);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  const selectedMeta = calendars.find(c => c.id === selected) || null;

  return (
    <Container maxWidth="md" sx={{ py: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h5">Workspace Settings</Typography>
        <Typography variant="body2" color="text.secondary">
          Choose the business calendar, create a new one, or set a strong color.
        </Typography>

        {error && <Alert severity="error">{error}</Alert>}

        {loading ? (
          <Box display="flex" alignItems="center" gap={1}><CircularProgress size={20}/> Loading…</Box>
        ) : (
          <>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
              <FormControl fullWidth>
                <InputLabel id="bizcal-label">Business calendar</InputLabel>
                <Select
                  labelId="bizcal-label"
                  label="Business calendar"
                  value={selected}
                  onChange={(e) => setSelected(String(e.target.value))}
                >
                  <MenuItem value=""><em>(none)</em></MenuItem>
                  {calendars.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.summary}{c.primary ? ' (primary)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Stack direction="row" spacing={1}>
                <Button variant="outlined" onClick={() => setCreateOpen(true)}>
                  Create new
                </Button>
                {/* <Button
                  variant="outlined"
                  disabled={!selected}
                  onClick={() => {
                    if (selectedMeta?.bg) setRecolorColor(selectedMeta.bg);
                    setRecolorOpen(true);
                  }}
                >
                  Set color…
                </Button> */}
              </Stack>
            </Stack>

            <Divider />

            <Stack direction="row" spacing={2} alignItems="center" justifyContent="flex-end">
              {saving && <CircularProgress size={18} />}
              <Button onClick={handleSave} variant="contained" disabled={saving}>
                Save
              </Button>
            </Stack>
          </>
        )}
      </Stack>

      {/* Create Calendar dialog — full CreateCalendarInput */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create calendar</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              margin="dense"
              label="Calendar name"
              fullWidth
              required
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
            />

            {/* Time zone with Chrome trick (Intl.supportedValuesOf) */}
            <Autocomplete
              options={tzOptions}
              value={createTimeZone || null}
              onChange={(_, v) => setCreateTimeZone((v || '').trim())}
              freeSolo
              autoHighlight
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Time zone"
                  placeholder={tzOptions.length ? 'Search time zone…' : 'e.g. America/Los_Angeles'}
                  helperText="Leave blank to use account default"
                  margin="dense"
                  fullWidth
                />
              )}
            />

            <TextField
              margin="dense"
              label="Description"
              fullWidth
              multiline
              minRows={2}
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
            />

            <TextField
              margin="dense"
              label="Location"
              fullWidth
              value={createLocation}
              onChange={(e) => setCreateLocation(e.target.value)}
            />

            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>Color</Typography>
              <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap>
                {SAFE_COLORS.map(c => (
                  <ColorSwatch
                    key={c}
                    color={c}
                    selected={createColor === c}
                    onClick={() => setCreateColor(c)}
                  />
                ))}
              </Stack>
            </Box>

            <FormControlLabel
              control={<Switch checked={createSelected} onChange={(e) => setCreateSelected(e.target.checked)} />}
              label="Mark as selected in my calendar list"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateCalendar} disabled={!createName.trim()}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Recolor existing calendar */}
      <Dialog open={recolorOpen} onClose={() => setRecolorOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Set calendar color</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {selectedMeta ? `Calendar: ${selectedMeta.summary}` : ''}
            </Typography>
            <Stack direction="row" spacing={1.2} flexWrap="wrap" useFlexGap>
              {SAFE_COLORS.map(c => (
                <ColorSwatch
                  key={c}
                  color={c}
                  selected={recolorColor === c}
                  onClick={() => setRecolorColor(c)}
                />
              ))}
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRecolorOpen(false)}>Cancel</Button>
          <Button onClick={handleApplyColorToExisting} disabled={!selected}>
            Apply
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export function initSettings(containerSelector: string) {
  const el = document.querySelector(containerSelector);
  if (!el) throw new Error('settings container not found');
  const root = createRoot(el as HTMLElement);
  root.render(<SettingsApp />);
}
