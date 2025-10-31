// OptyDetailsDrawer.tsx (TypeScript, class-based)
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
  Drawer, Box, IconButton, Typography, Divider, Tabs, Tab, Stack,
  Chip, Link, ThemeProvider, Tooltip, TextField, Button
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew'; // still used for Google Calendar links
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import SaveIcon from '@mui/icons-material/Save';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import LinkIcon from '@mui/icons-material/Link';
import DeleteIcon from '@mui/icons-material/Delete';
import { FormControl, Select, MenuItem } from '@mui/material';
import { Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';
import type { OpportunityStage } from '../types/interfaces';
import type { CalEvt } from '../types/interfaces';
import type { Opty } from '../types/interfaces';
import { compactTheme } from '../theme/compactTheme';


import { WorkroomMilestones } from '../workroommilestones';
import { TiptapActionsEditorMUI } from '../tiptapeditor';



const STAGE_COLORS: Record<OpportunityStage, string> = {
  examining: "#4CAF50", // green
  applied:   "#FF9800", // orange
  awarded:   "#F44336", // red
  submitted: "#FFEB3B", // yellow
  paid:      "#2196F3"  // blue
};

type Props = {
  open: boolean;
  row: Opty | null;
  events: CalEvt[];
  onClose(): void;
  fmtDate(v?: string | Date | null): string;
  paySummary(row: Opty): string | null;
  onClosed?: () => void;
};

type ContactLike = { name: string; role: string; email: string; phone: string; source?: 'page' };

type State = {
  tab: number;

  // ---- editable fields (Overview form) ----
  f_title: string;
  f_company: string;
  f_location: string;
  f_summary: string;        // maps to description_summary
  f_comp_type: string;
  f_comp_text: string;
  f_skills_text: string;    // comma separated
  f_deliverables_text: string; // one per line
  f_notes: string;
  f_contacts: ContactLike[];

  // Contacts row-level editing
  editingContactIdx: number | null;
  editingContactIdxIsNew: boolean;
  contactDraft: ContactLike | null;

  saving: boolean;
  dirty: boolean;
  saveMsg: string | null;

  f_stage: OpportunityStage;
  stageSaving: boolean;
  stageMsg: string | null;
  deleteStep: number;       // 0=closed, 1=first confirm, 2=second confirm
  deleting: boolean;
};

function normContact(x: Partial<ContactLike> | null | undefined): ContactLike {
  return {
    name:  (x?.name  || '').trim(),
    role:  (x?.role  || '').trim(),
    email: (x?.email || '').trim(),
    phone: (x?.phone || '').trim(),
    source: 'page'
  };
}
function hexToRgb(h: string): { r: number; g: number; b: number } {
  const s = h.replace('#', '');
  const n = s.length === 3
    ? s.split('').map((c) => c + c).join('')
    : s;
  const num = parseInt(n, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function relLuminance(r: number, g: number, b: number): number {
  function c(u: number) { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); }
  const R = c(r), G = c(g), B = c(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function readableTextOn(hex: string): string {
  try {
    const { r, g, b } = hexToRgb(hex || '#ffffff');
    // pick black/white for contrast; threshold ~0.179 is common
    return relLuminance(r, g, b) > 0.179 ? '#111' : '#fff';
  } catch { return '#111'; }
}
function fmtDate(d?: Date | null): string {
  if (!d) return "";
  if (!(d instanceof Date) || isNaN(d.getTime())) return String(d);
  return d.toLocaleDateString(); // ← only the date, no time
}

export default class OptyDetailsDrawer extends React.Component<Props, State> {
  public constructor(props: Props) {
    super(props);
    const row = props.row || ({} as any);
    this.state = {
      tab: 0,
      f_title: row.title || '',
      f_company: row.company || '',
      f_location: row.location || '',
      f_summary: row.description_summary || '',
      f_comp_type: row.comp_type || '',
      f_comp_text: row.comp_text || '',
      f_skills_text: Array.isArray(row.skills) ? row.skills.join(', ') : '',
      f_deliverables_text: Array.isArray(row.deliverables) ? row.deliverables.join('\n') : '',
      f_notes: row.notes || '',
      f_contacts: Array.isArray(row.contacts) ? row.contacts.map(normContact) : [],

      editingContactIdx: null,
      editingContactIdxIsNew: false,
      contactDraft: null,

      saving: false,
      dirty: false,
      saveMsg: null,
      f_stage: (row.funnel_stage as OpportunityStage) || 'examining',
      stageSaving: false,
      stageMsg: null,
      deleteStep: 0,       // 0=closed, 1=first confirm, 2=second confirm
      deleting: false,
    };
    this.handleClose = this.handleClose.bind(this);
  }

  private openDeleteStep1(): void { this.setState({ deleteStep: 1 }); }
  private cancelDelete(): void { this.setState({ deleteStep: 0, deleting: false }); }
  private proceedToStep2(): void { this.setState({ deleteStep: 2 }); }

  private async purgeCalendarEventsForOpty(optyId: string): Promise<number> {
    try {
      const store = (window as any).calendarStore;
      if (!store?.deleteAllEventsForOpty) return 0;

      // prefer user-selected business calendar, fallback to active one
      const calId =
        (window as any).settings?.business_calendar ||
        store.getActiveCalendarId?.();

      return await store.deleteAllEventsForOpty(String(optyId), calId);
    } catch {
      return 0; // best-effort
    }
  }


  private async performDelete(purgeEvents: boolean): Promise<void> {
    if (!this.props.row) { this.cancelDelete(); return; }
    const optyId = (this.props.row as any).opty_id;
    if (!optyId) { this.cancelDelete(); return; }

    this.setState({ deleting: true });

    try {
      if (purgeEvents) {
        await this.purgeCalendarEventsForOpty(String(optyId));
      }

      // unanchor calendar
      try {
        (window as any).CalendarUI?.clearAnchor?.();
        (window as any).panel?.setCurrentOpty?.(null);
      } catch {}

      // delete the Firestore doc
      const res = await chrome.runtime.sendMessage({
        type: 'job/deleteByOptyId',
        opty_id: String(optyId)
      });
      if (!res?.ok) throw new Error(res?.error || 'Delete failed');

      // close
      this.setState({ deleting: false, deleteStep: 0 });
      this.handleClose();
    } catch (e: any) {
      this.setState({ deleting: false, deleteStep: 0, saveMsg: 'Delete failed: ' + (e?.message || e) });
    }
  }


  private latestLoadToken: string | null = null;
  private async loadLatestByOpty(): Promise<void> {
    const base = this.props.row as any;
    if (!base || !base.opty_id) return;

    // prevent race: ignore outdated responses
    const token = String(Date.now());
    this.latestLoadToken = token;

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'job/byOptyId',
        opty_id: String(base.opty_id)
      });
      if (!res || !res.ok) return;
      if (this.latestLoadToken !== token) return; // stale

      const fresh = res.data || null;
      if (fresh) this.applyRowToState(fresh);
    } catch {
      // silent: drawer still shows grid snapshot
    }
  }
  private handleClose(): void {
    try { if (this.props.onClose) this.props.onClose(); } finally {
      try { if (this.props.onClosed) this.props.onClosed(); } catch {}
    }
  }
  private applyRowToState(r: any): void {
    this.setState({
      f_title: r?.title || '',
      f_company: r?.company || '',
      f_location: r?.location || '',
      f_summary: r?.description_summary || '',
      f_comp_type: r?.comp_type || '',
      f_comp_text: r?.comp_text || '',
      f_skills_text: Array.isArray(r?.skills) ? r.skills.join(', ') : '',
      f_deliverables_text: Array.isArray(r?.deliverables) ? r.deliverables.join('\n') : '',
      f_notes: r?.notes || '',
      f_contacts: Array.isArray(r?.contacts) ? r.contacts.map(normContact) : [],
      editingContactIdx: null,
      contactDraft: null,
      dirty: false,
      saveMsg: null
    });
  }

  componentDidMount(): void {
    this.loadLatestByOpty().catch(function(){});
  }

  componentDidUpdate(prevProps: Props) {
    // existing state sync (keep)
    if (prevProps.row !== this.props.row && this.props.row) {
      const r = this.props.row;
      this.setState({
        f_title: r.title || '',
        f_company: r.company || '',
        f_location: r.location || '',
        f_summary: r.description_summary || '',
        f_comp_type: r.comp_type || '',
        f_comp_text: r.comp_text || '',
        f_skills_text: Array.isArray(r.skills) ? r.skills.join(', ') : '',
        f_deliverables_text: Array.isArray(r.deliverables) ? r.deliverables.join('\n') : '',
        f_notes: r.notes || '',
        f_contacts: Array.isArray(r.contacts) ? r.contacts.map(normContact) : [],
        editingContactIdx: null,
        contactDraft: null,
        dirty: false,
        saveMsg: null,
        f_stage: (r.funnel_stage as OpportunityStage) || 'examining',
        stageSaving: false,
        stageMsg: null,
      });
    }

    // NEW: if opty_id changed, re-fetch latest from the store
    const prevId = (prevProps.row as any)?.opty_id || null;
    const currId = (this.props.row as any)?.opty_id || null;
    if (prevId !== currId && currId) {
      this.loadLatestByOpty().catch(function(){});
    }
  }

  private headerColors(): { bg: string; fg: string } {
    const stage = (this.state.f_stage || 'examining') as any;
    const bg = STAGE_COLORS[stage] || '#eee';
    const fg = readableTextOn(bg);
    return { bg, fg };
  }

  private onTabChange = (_e: any, v: number) => {
    this.setState({ tab: v });
  };

  private markDirty = () => this.setState({ dirty: true, saveMsg: null });

  private parseSkills(): string[] {
    return (this.state.f_skills_text || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  private parseDeliverables(): string[] {
    return (this.state.f_deliverables_text || '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
  }

  private async saveContactsPatch(list: ContactLike[]): Promise<void> {
    if (!this.props.row) return;
    const optyId = (this.props.row as any).opty_id;
    if (!optyId) { this.setState({ saveMsg: 'Missing opty_id; cannot save.' }); return; }

    const patch = { contacts: list.map(normContact) };

    const res = await chrome.runtime.sendMessage({
      type: 'job/updateByOptyId',
      opty_id: String(optyId),
      patch
    });
    if (!res?.ok) throw new Error(res?.error || 'Update failed');
  }

  private async saveEdits() {
    if (!this.props.row) return;
    const optyId = (this.props.row as any).opty_id;
    if (!optyId) { this.setState({ saveMsg: 'Missing opty_id; cannot save.' }); return; }

    const patch = {
      title: this.state.f_title.trim(),
      company: this.state.f_company.trim(),
      location: this.state.f_location.trim(),
      description_summary: this.state.f_summary.trim() || null,
      comp_type: this.state.f_comp_type.trim(),
      comp_text: this.state.f_comp_text.trim(),
      skills: this.parseSkills(),
      deliverables: this.parseDeliverables(),
      notes: this.state.f_notes.trim() || null,
      // Leave url/platform/post_date/saved_at read-only
      contacts: this.state.f_contacts.map(normContact),
    };

    try {
      this.setState({ saving: true, saveMsg: null });
      const res = await chrome.runtime.sendMessage({
        type: 'job/updateByOptyId',
        opty_id: String(optyId),
        patch
      });
      if (!res?.ok) throw new Error(res?.error || 'Update failed');

      this.setState({ saving: false, dirty: false, saveMsg: 'Saved ✓' });
      this.loadLatestByOpty().catch(function(){});
    } catch (e: any) {
      this.setState({ saving: false, saveMsg: 'Save failed: ' + (e?.message || e) });
    }
  }


  private getHighlightFocusDate(): Date | null {
    const list = this.props.events || [];
    if (list.length && list[0]?.start) {
      try { return new Date(list[0].start as any); } catch {}
    }
    return new Date(); // fallback: today
  }

  private anchorToCalendar = (focusDate?: Date | null) => {
    const row = this.props.row;
    if (!row) return;
    if ((window as any).panel?.anchorCalendarToOpty) {
      (window as any).panel.anchorCalendarToOpty(row, focusDate || null);
    } else if ((window as any).CalendarUI?.setAnchor && (row as any).opty_id) {
      (window as any).CalendarUI.setAnchor({
        optyId: String((row as any).opty_id),
        meta: row,
        focusDate: focusDate || null
      });
    }
    this.handleClose();
  };

  // ---------- Contacts CRUD helpers ----------

  private startEditContact(idx: number): void {
    const draft = normContact(this.state.f_contacts[idx]);
    this.setState({ editingContactIdx: idx, contactDraft: draft, editingContactIdxIsNew: false, saveMsg: null });
  }

  private cancelEditContact(): void {
    const isNew = this.state.editingContactIdxIsNew;
    const idx = this.state.editingContactIdx;

    if (isNew && idx != null) {
      const list = this.state.f_contacts.slice();
      list.splice(idx, 1);
      this.setState({
        f_contacts: list,
        editingContactIdx: null,
        contactDraft: null,
        editingContactIdxIsNew: false,
        saveMsg: null
      });
    } else {
      this.setState({ editingContactIdx: null, contactDraft: null, editingContactIdxIsNew: false, saveMsg: null });
    }
  }


  private updateContactDraft(patch: Partial<ContactLike>): void {
    const d = Object.assign({}, this.state.contactDraft || { name:'', role:'', email:'', phone:'', source:'page' }, patch);
    this.setState({ contactDraft: normContact(d) });
  }

  private async saveEditedContact(): Promise<void> {
    if (this.state.editingContactIdx == null) return;
    const idx = this.state.editingContactIdx;
    const list = this.state.f_contacts.slice();
    list[idx] = normContact(this.state.contactDraft || list[idx]);

    this.setState({
      f_contacts: list,
      editingContactIdx: null,
      contactDraft: null,
      editingContactIdxIsNew: false,
      saving: true,
      saveMsg: null
    });

    try {
      await this.saveContactsPatch(list);
      this.setState({ saving: false, saveMsg: 'Saved ✓' });
      this.loadLatestByOpty().catch(function(){});
    } catch (e: any) {
      this.setState({ saving: false, saveMsg: 'Save failed: ' + (e?.message || e) });
    }
  }


  private addContactRow(): void {
    const list = this.state.f_contacts.slice();
    const idx = list.length;
    const blank: ContactLike = { name: '', role: '', email: '', phone: '', source: 'page' as const };
    list.push(blank);
    this.setState({
      f_contacts: list,
      editingContactIdx: idx,
      contactDraft: normContact(blank),
      editingContactIdxIsNew: true,
      saveMsg: null
    });
  }


  private async removeContactRow(idx: number): Promise<void> {
    const list = this.state.f_contacts.slice();
    list.splice(idx, 1);

    // reflect UI change immediately
    this.setState({ f_contacts: list, saving: true, saveMsg: null });

    try {
      await this.saveContactsPatch(list);
      this.setState({ saving: false, saveMsg: 'Saved ✓' });
      this.loadLatestByOpty().catch(function(){});
    } catch (e: any) {
      // keep UI change but tell the user; they can hit Save to retry later
      this.setState({ saving: false, saveMsg: 'Save failed: ' + (e?.message || e) });
    }
  }

  private onStageChange(e: any): void {
    const v = (e?.target?.value || 'examining') as OpportunityStage;
    this.setState({ f_stage: v, stageSaving: true, stageMsg: null });
    this.saveStage(v).catch(function(){});
  }

  private async saveStage(v: OpportunityStage): Promise<void> {
    if (!this.props.row) { this.setState({ stageSaving: false }); return; }
    const optyId = (this.props.row as any).opty_id;
    if (!optyId) { this.setState({ stageSaving: false, stageMsg: 'Missing opty_id' }); return; }

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'job/updateByOptyId',
        opty_id: String(optyId),
        patch: { funnel_stage: v }
      });
      if (!res?.ok) throw new Error(res?.error || 'Update failed');
      this.setState({ stageSaving: false, stageMsg: '✓' });
    } catch (e: any) {
      this.setState({ stageSaving: false, stageMsg: 'Save failed ⚠' });
    }
  }

  // ---- Overview is a form ----
  private renderOverviewTabForm(row: Opty): React.ReactNode {
    return (
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}></Typography>
          <Button
            size="small"
            startIcon={<SaveIcon />}
            variant="contained"
            onClick={() => this.saveEdits()}
            disabled={this.state.saving || !this.state.dirty}
          >
            Save
          </Button>
          {this.state.saveMsg
            ? <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{this.state.saveMsg}</Typography>
            : null}
        </Stack>

        <TextField
          label="Title"
          value={this.state.f_title}
          onChange={(e) => { this.setState({ f_title: e.target.value }); this.markDirty(); }}
          fullWidth
          size="small"
        />
        <Stack direction="row" spacing={2}>
          <TextField
            label="Client"
            value={this.state.f_company}
            onChange={(e) => { this.setState({ f_company: e.target.value }); this.markDirty(); }}
            size="small"
            fullWidth
            sx={{ flex: 1 }}
          />
          <TextField
            label="Location"
            value={this.state.f_location}
            onChange={(e) => { this.setState({ f_location: e.target.value }); this.markDirty(); }}
            size="small"
            fullWidth
            sx={{ flex: 1 }}
          />
        </Stack>
        <Stack direction="row" spacing={2}>
          <TextField
            label="Type"
            value={this.state.f_comp_type}
            onChange={(e) => { this.setState({ f_comp_type: e.target.value }); this.markDirty(); }}
            placeholder="fixed | hourly"
            fullWidth size="small"
          />
          <TextField
            label="Text"
            value={this.state.f_comp_text}
            onChange={(e) => { this.setState({ f_comp_text: e.target.value }); this.markDirty(); }}
            placeholder="$10–30 AUD"
            fullWidth size="small"
          />
        </Stack>
        <TextField
          value={this.state.f_summary}
          onChange={(e) => { this.setState({ f_summary: e.target.value }); this.markDirty(); }}
          multiline rows={5} fullWidth size="small"
          label="Summary"
        />
        <TextField
          value={this.state.f_skills_text}
          onChange={(e) => { this.setState({ f_skills_text: e.target.value }); this.markDirty(); }}
          placeholder="comma,separated,skills"
          multiline fullWidth size="small" rows={3}
          label="Skills"
        />

        <TextField
          value={this.state.f_deliverables_text}
          onChange={(e) => { this.setState({ f_deliverables_text: e.target.value }); this.markDirty(); }}
          placeholder="one per line"
          multiline fullWidth size="small" rows={4}
          label="Deliverables"
        />

        <TextField
          value={this.state.f_notes}
          onChange={(e) => { this.setState({ f_notes: e.target.value }); this.markDirty(); }}
          multiline rows={4} fullWidth size="small"
          label="Notes"
        />

        {/* Read-only meta (kept here) */}
        <Divider />
        <Box sx={{ flexGrow: 1 }} />
        <Button
            startIcon={<DeleteIcon />}
            variant="outlined"
            color="error"
            onClick={() => this.openDeleteStep1()}
            disabled={this.state.saving}
          >
            Delete
        </Button>
      </Stack>
    );
  }

  private renderTextEditor(row: Opty): React.ReactNode {
    return <TiptapActionsEditorMUI
    row={row}
    actions={{
      withCode: function(selected, code, cb, ctx) {
        // e.g., call your service, use ctx.row for context
        // async OK — just call cb when ready
        // fetch(...).then(r => r.text()).then(out => cb(out));
        debugger;
        cb("[" + (code || "") + "] " + selected);
      }
    }}
  />

  }

  private renderMockMarketToolsTab(row: Opty): React.ReactNode {
    return <WorkroomMilestones  row={row} onClose={this.handleClose} />;
  }

  private renderContactsTab(row: Opty): React.ReactNode {
    const self = this;

    function mail(label: string): React.ReactNode {
      return label
        ? <Link href={'mailto:' + label} underline="hover">{label}</Link>
        : <Typography component="span" color="text.secondary"></Typography>;
    }

    function tel(label: string): React.ReactNode {
      return label
        ? <Link href={'tel:' + label} underline="hover">{label}</Link>
        : <Typography component="span" color="text.secondary"></Typography>;
    }



    return (
      <Stack spacing={1.5}>
        <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', mb: 1 }}>
          <Button
            size="small"
            startIcon={<AddIcon />}
            variant="contained"
            onClick={function(){ self.addContactRow(); }}
          >
            Add
          </Button>
        </Box>

        {this.state.f_contacts.length === 0
          ? <Typography variant="body2">No contacts.</Typography>
          : null}

        {this.state.f_contacts.map(function (c, idx) {
          const isEditing = self.state.editingContactIdx === idx;

          if (isEditing) {
            const d = self.state.contactDraft || c;
            return (
              <Box key={idx} sx={{ p: 1, border: '1px solid #eee', borderRadius: 1 }}>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      label="Name"
                      value={d.name}
                      onChange={function (e: any) { self.updateContactDraft({ name: e.target.value }); }}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Role"
                      value={d.role}
                      onChange={function (e: any) { self.updateContactDraft({ role: e.target.value }); }}
                      size="small"
                      fullWidth
                    />
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <TextField
                      label="Email"
                      value={d.email}
                      onChange={function (e: any) { self.updateContactDraft({ email: e.target.value }); }}
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Phone"
                      value={d.phone}
                      onChange={function (e: any) { self.updateContactDraft({ phone: e.target.value }); }}
                      size="small"
                      fullWidth
                    />
                  </Stack>
                  <Stack direction="row" spacing={1} justifyContent="flex-end">
                    <Button size="small" variant="outlined" onClick={function(){ self.cancelEditContact(); }}>Cancel</Button>
                    <Button size="small" variant="contained" onClick={function(){ self.saveEditedContact(); }} disabled={self.state.saving}>
                      Save
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            );
          }

          // VIEW MODE
          const line = [c.name, c.role].filter(Boolean).join(' · ') || '—';

          return (
            <Box key={idx} sx={{ p: 1, border: '1px solid #eee', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>{line}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {mail(c.email)}{' · '}{tel(c.phone)}
                  </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={function(){ self.startEditContact(idx); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" onClick={function(){ self.removeContactRow(idx); }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Stack>
    );
  }

  private renderDeadlinesTab(): React.ReactNode {
    const list = this.props.events || [];
    const row = this.props.row;

    // Top bar with "Add" (creates a new event, anchored to this gig)
    const addBar = (row && (row as any).opty_id) ? (
      <Box sx={{ display:'flex', alignItems:'center', justifyContent:'space-between', mb: 1 }}>
        <Button
          size="small"
          startIcon={<AddIcon />}
          variant="contained"
          onClick={() => {
            const start = new Date();
            const end = new Date(start.getTime() + 30 * 60 * 1000);
            try {
              (window as any).CalendarUI?.openCreate?.(
                start,
                end,
                { optyId: String((row as any).opty_id), meta: row } // <-- pass link
              );
            } catch {}
            this.handleClose();
          }}
        >
          Add
        </Button>
      </Box>
    ) : null;

    if (!list.length) {
      return (
        <Stack spacing={1}>
          {addBar}
          <Typography variant="body2">No deadlines.</Typography>
        </Stack>
      );
    }

    return (
      <Stack spacing={1}>
        {addBar}
        {list.map((d, idx) => {
          const when = d.start ? fmtDate(d.start) : 'unknown';
          const lbl = d.importance || 'other';
          const focusDate = d.start ? new Date(d.start) : null;

          return (
            <Box key={idx} sx={{ p: 1, border: '1px solid #eee', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="caption" sx={{ fontWeight: '500' }} noWrap>
                    {lbl}: {when}
                  </Typography>
                  {d.title ? (
                    <Typography variant="body2" color="text.secondary" sx={{ display: 'block' }} noWrap>
                      {d.title}
                    </Typography>
                  ) : null}
                </Box>

                {/* Actions: Edit • See on calendar • Open in Google Calendar */}
                <Box sx={{ display: 'flex', alignItems: 'center', ml: 1 }}>
                  {/* Edit: open the event editor for this event */}
                  <Tooltip title="Edit">
                    <IconButton
                      size="small"
                      aria-label="Edit deadline"
                      onClick={(e) => {
                        e.preventDefault();
                        try {
                          (window as any).CalendarUI?.openEdit?.(d);
                        } catch {}
                        this.handleClose();
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  {/* See on calendar */}
                  <Tooltip title="See on calendar">
                    <IconButton
                      size="small"
                      aria-label="See on calendar"
                      onClick={(e) => {
                        e.preventDefault();
                        this.anchorToCalendar(focusDate);
                      }}
                    >
                      <CalendarMonthIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  {/* Open in Google Calendar */}
                  {d.htmlLink ? (
                    <Tooltip title="Open in Google Calendar">
                      <IconButton
                        size="small"
                        aria-label="Open in Google Calendar"
                        component="a"
                        href={d.htmlLink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Stack>
    );
  }

  public render(): React.ReactNode {
    const row = this.props.row;
    if (!row) return null;
    const self = this;

    const hasOpty = !!(row as any).opty_id;

    const hc = this.headerColors();
    return (
      <ThemeProvider theme={compactTheme}>
        <Drawer anchor="right" open={this.props.open} onClose={this.handleClose} PaperProps={{ sx: { width: 720 } }}>
          {/* HEADER: X | Title | Stage | Highlight | Close */}
          <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 1, gap: 1, bgcolor: hc.bg, color: hc.fg }}>
            {row.url ? (
              <Tooltip title="Open original link">
                <IconButton component="a" href={row.url} target="_blank" rel="noreferrer" size="small">
                  <LinkIcon />
                </IconButton>
              </Tooltip>
            ) : null}

            <Typography variant="h6" sx={{ ml: 0.5, mr: 1, flexGrow: 1 }} noWrap>
              {row.title || 'Untitled'}
            </Typography>

            {/* +++ NEW: Funnel Stage control +++ */}
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <Select
                value={this.state.f_stage || 'examining'}
                onChange={(e) => this.onStageChange(e)}
                displayEmpty
                sx={{ bgcolor: '#fff' }}
                renderValue={(val: any) => {
                  const s = (val || 'examining') as OpportunityStage;
                  return (
                    <Box sx={{ display:'flex', alignItems:'center', bgcolor:"#fff" }}>
                      <Box sx={{
                        width: 12, height: 12, borderRadius: '3px', bgcolor: STAGE_COLORS[s],
                        border: '1px solid #e0e0e0', mr: 1, display: 'inline-block'
                      }} />
                      {s}
                    </Box>
                  );
                }}
              >
                {(['examining','applied','submitted','awarded','paid'] as OpportunityStage[]).map((s) => (
                  <MenuItem key={s} value={s}>
                    <Box sx={{
                      width: 12, height: 12, borderRadius: '3px', bgcolor: STAGE_COLORS[s],
                      mr: 1, border: '1px solid #e0e0e0', display:'inline-block'
                    }} />
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {this.state.stageMsg
              ? <Typography variant="caption" color="text.secondary" sx={{ ml: 0.5 }}>
                  {this.state.stageSaving ? 'Saving…' : this.state.stageMsg}
                </Typography>
              : null}

            <IconButton onClick={this.handleClose}><CloseIcon /></IconButton>
          </Box>

          {hasOpty ? (
            <Stack direction="row" spacing={2} sx={{ display: 'flex', alignItems: 'center', px: 1, py: 1, gap: 1, bgcolor: hc.bg, color: hc.fg }}>
                <Button
                  variant="contained"
                  sx={{
                    bgcolor: '#2c2f32',
                    color: '#ffffff',
                    margin: "0px 45px 5px !important",
                    borderRadius: "10px !important",
                    backgroundColor: "#4a4b4b !important",
                    padding: "10px 20px !important",
                    // borderRadius: 2,
                    textTransform: 'none',
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    width: '45%',
                    boxShadow: 3,
                    '&:hover': { bgcolor: '#25292d', boxShadow: 6 },
                  }}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    const focus = this.getHighlightFocusDate();
                    this.anchorToCalendar(focus);
                  }}
                >
                  Highlight on calendar<CalendarMonthIcon sx={{ marginLeft:"10px"}} />
                </Button>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 1, gap: 3, bgcolor: hc.bg, color: hc.fg }}>
                {row.platform ? (
                <Typography variant="body2" color="text.secondary" sx={{height:"-webkit-fill-available"}}>
                  <b>Platform:</b> {row.platform }
                </Typography>
                ) : <Box sx={{ flexShrink: 0 }} />}
                <Box sx={{ textAlign: 'left' }}>
                {row.saved_at ?
                  <Typography variant="caption" color="text.secondary" display="block">
                    <b>Created:</b> {fmtDate(new Date(row.saved_at))}
                  </Typography>
                  : null}
                  {row.post_date ? (
                    <Typography variant="caption" color="text.secondary" display="block">
                      <b>Posted:</b> {fmtDate(new Date(row.post_date))}
                    </Typography>
                  ) : null}
                </Box>
              </Box>
            </Stack>
          ) : null}
          <Divider />

          <Tabs value={this.state.tab} onChange={function (e, v) { self.onTabChange(e, v); }}>
            <Tab label="Overview" />
            <Tab label="Contacts" />
            <Tab label="Deadlines" />
            <Tab label="Text Editor" />
            {(row.platform === 'MockMarket')? <Tab label="Mock Market Tools" /> : null}
            {(row.platform === 'Toptal')? <Tab label="Toptal Tools" /> : null}
          </Tabs>

          <Box sx={{ p: 2, overflow: 'auto' }}>
            {this.state.tab === 0 ? this.renderOverviewTabForm(row) : null}
            {this.state.tab === 1 ? this.renderContactsTab(row) : null}
            {this.state.tab === 2 ? this.renderDeadlinesTab() : null}
            {this.state.tab === 3 ? this.renderTextEditor(row) : null}
            {this.state.tab === 3 && (row.platform === 'MockMarket') ? this.renderMockMarketToolsTab(row) : null}
          </Box>
        </Drawer>
        <Dialog open={this.state.deleteStep === 1} onClose={() => this.cancelDelete()}>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              The delete operation is an irreversible operation.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => this.cancelDelete()}>Cancel</Button>
            <Button color="error" variant="contained" onClick={() => this.proceedToStep2()}>
              Yes, continue
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog open={this.state.deleteStep === 2} onClose={() => this.cancelDelete()}>
          <DialogTitle>Remove calendar events too?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              Do you also want to remove <b>all</b> calendar events linked to this gig/contract?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => this.cancelDelete()} disabled={this.state.deleting}>Cancel</Button>
            <Button onClick={() => this.performDelete(false)} disabled={this.state.deleting}>
              No, keep events
            </Button>
            <Button color="error" variant="contained" disabled={this.state.deleting} onClick={() => this.performDelete(true)}>
              {this.state.deleting ? 'Deleting…' : 'Yes, delete events & gig'}
            </Button>
          </DialogActions>
        </Dialog>



      </ThemeProvider>
    );
  }
}

var root: Root | null = null;
export function openOptyDetailsDrawer(row: Opty, events: CalEvt[], onClosed?: () => void) {
  const host = document.getElementById('opty-drawer-root') || (function () {
    const d = document.createElement('div'); d.id = 'opty-drawer-root'; document.body.appendChild(d); return d;
  })();
  if (!root) root = createRoot(host);
  function close() { if (root) root.render(null); }
  function fmtDate(v: any) { return v ? new Date(v).toLocaleString() : '—'; }
  function paySummary(r: Opty) {
    if (r.comp_text) return r.comp_text;
    if (r.comp_type) return r.comp_type;
    return null;
  }
  root.render(React.createElement(OptyDetailsDrawer, {
    open: true, row, events, onClose: close, onClosed, fmtDate, paySummary
  }));
}
