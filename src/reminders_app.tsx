/* src/reminders_app.tsx */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const chrome: any;

import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { ThemeProvider, createTheme } from '@mui/material/styles';
import { compactTheme } from './theme/compactTheme';

import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemSecondaryAction from '@mui/material/ListItemSecondaryAction';
import Divider from '@mui/material/Divider';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Paper from '@mui/material/Paper';
import LinearProgress from '@mui/material/LinearProgress';
import { alpha } from '@mui/material/styles';

import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import EventIcon from '@mui/icons-material/Event';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';

type ReminderItem = {
  id: string;
  title?: string;
  when: number;         // epoch ms
  checked?: boolean;
  meta?: Record<string, any> | null;
};

type RemListResponse = {
  ok: boolean;
  items: ReminderItem[];
  dueNow?: string[];    // ids
  graceUntil?: number;  // epoch ms
};

function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const datePart = sameDay
    ? 'Today'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });

  const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

function isDue(it: ReminderItem): boolean {
  return !it.checked && typeof it.when === 'number' && Date.now() >= it.when;
}

function useInterval(cb: () => void, ms: number | null) {
  React.useEffect(() => {
    if (ms == null) return;
    const t = setInterval(cb, ms);
    return () => clearInterval(t);
  }, [cb, ms]);
}

function Subtitle({ items, graceUntil }: { items: ReminderItem[]; graceUntil: number; }) {
  const [, force] = React.useReducer((c) => c + 1, 0);

  useInterval(() => {
    force();
  }, graceUntil && Date.now() < graceUntil ? 1000 : null);

  const dueCount = items.filter(isDue).length;
  const parts: string[] = [`${dueCount} due`];

  if (graceUntil && Date.now() < graceUntil) {
    const secs = Math.max(0, Math.ceil((graceUntil - Date.now()) / 1000));
    const mm = Math.floor(secs / 60);
    const ss = secs % 60;
    parts.push(`grace ${mm}:${String(ss).padStart(2, '0')}`);
  }

  return (
    <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
      {parts.join(' · ')}
    </Typography>
  );
}

function EmptyState() {
  return (
    <Paper
      elevation={0}
      sx={{
        m: 2, p: 3,
        border: '1px dashed',
        borderColor: 'divider',
        bgcolor: (t) => alpha(t.palette.primary.light, 0.06),
        textAlign: 'center'
      }}
    >
      <EventIcon sx={{ color: 'text.secondary', mb: 1 }} />
      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
        No due reminders
      </Typography>
      <Typography variant="body2" color="text.secondary">
        You’re all caught up. We’ll pop back in when something’s due.
      </Typography>
    </Paper>
  );
}

function MetaChips({ meta }: { meta: Record<string, any> | null | undefined }) {
  if (!meta || typeof meta !== 'object') return null;
  const entries = Object.entries(meta).filter(([_, v]) => v != null && v !== '');
  if (!entries.length) return null;
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
      {entries.slice(0, 6).map(([k, v]) => (
        <Chip key={k} size="small" variant="outlined" label={`${k}: ${String(v).slice(0, 80)}`} />
      ))}
      {entries.length > 6 && (
        <Chip size="small" color="info" icon={<InfoOutlinedIcon />} label={`+${entries.length - 6} more`} />
      )}
    </Stack>
  );
}

function useReminders() {
  const [items, setItems] = React.useState<ReminderItem[]>([]);
  const [graceUntil, setGraceUntil] = React.useState<number>(0);
  const [loading, setLoading] = React.useState<boolean>(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const res: RemListResponse = await chrome.runtime.sendMessage({ type: 'rem/list' });
      if (res?.ok) {
        setItems(res.items || []);
        setGraceUntil(res.graceUntil || 0);
      }
    } catch {}
    finally { setLoading(false); }
  }, []);

  const markChecked = React.useCallback(async (ids: string[]) => {
    if (!ids?.length) return;
    try { await chrome.runtime.sendMessage({ type: 'rem/check', ids }); }
    catch {}
    await refresh();
  }, [refresh]);

  const markAllDue = React.useCallback(async () => {
    const ids = items.filter(isDue).map(i => i.id);
    if (!ids.length) return;
    await markChecked(ids);
  }, [items, markChecked]);

  const closeWithGrace = React.useCallback(async () => {
    try { await chrome.runtime.sendMessage({ type: 'rem/close' }); } catch {}
    window.close();
  }, []);

  // SW push updates
  React.useEffect(() => {
    const handler = (msg: any) => {
      if (msg && msg.type === 'rem/pushItems') refresh();
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, [refresh]);

  // initial
  React.useEffect(() => { refresh(); }, [refresh]);

  return { items, graceUntil, loading, refresh, markChecked, markAllDue, closeWithGrace };
}

function App() {
  const { items, graceUntil, loading, refresh, markChecked, markAllDue, closeWithGrace } = useReminders();
  const dueItems = React.useMemo(
    () => items.filter(isDue).sort((a, b) => (a.when - b.when) || (a.id > b.id ? 1 : -1)),
    [items]
  );

  return (
    <ThemeProvider theme={createTheme(compactTheme as any)}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <AppBar elevation={0} color="default" position="static" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
          <Toolbar variant="dense" sx={{ minHeight: 44 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Reminders
            </Typography>
            <Subtitle items={items} graceUntil={graceUntil} />
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={refresh}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close (snooze 20m)">
              <IconButton size="small" onClick={closeWithGrace}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Toolbar>
          {loading ? <LinearProgress /> : null}
        </AppBar>

        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {!dueItems.length ? (
            <EmptyState />
          ) : (
            <List dense disablePadding>
              {dueItems.map((it, idx) => (
                <React.Fragment key={it.id}>
                  <ListItem
                    alignItems="flex-start"
                    sx={{
                      py: 1,
                      px: 1.5,
                      '&:hover': { bgcolor: (t) => alpha(t.palette.primary.light, 0.06) }
                    }}
                  >
                    <ListItemText
                      primary={
                        <Typography variant="body1" sx={{ fontWeight: 600 }}>
                          {it.title || '(reminder)'}
                        </Typography>
                      }
                      secondary={
                        <React.Fragment>
                          <Typography component="span" variant="caption" color="text.secondary">
                            {fmtDateTime(it.when)}
                          </Typography>
                          <MetaChips meta={it.meta} />
                        </React.Fragment>
                      }
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="Mark as done">
                        <IconButton edge="end" size="small" color="success" onClick={() => markChecked([it.id])}>
                          <CheckCircleIcon />
                        </IconButton>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                  {idx < dueItems.length - 1 ? <Divider component="li" /> : null}
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>

        <Box
          sx={{
            p: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 1
          }}
        >
          <Button size="small" variant="outlined" onClick={refresh} startIcon={<RefreshIcon />}>
            Refresh
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<CheckCircleIcon />}
            onClick={markAllDue}
            disabled={!dueItems.length}
          >
            Mark all as done
          </Button>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

// Mount
(function main() {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('#root not found');
  const root = createRoot(rootEl);
  root.render(<App />);
})();
