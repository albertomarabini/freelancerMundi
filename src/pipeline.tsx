// /src/pipeline.tsx
// Pipeline grid (MUI DataGrid) + Details Drawer
// Constraints: TS, class components only, NO arrow funcs (even in JSX), NO .bind
declare const chrome: any;
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import {
  Box,
  Toolbar,
  TextField,
  Typography,
  Divider,
  MenuItem
} from "@mui/material";

import {
  DataGrid,
  GridColDef,
  GridRowParams,
  GridToolbar,
  GridToolbarContainer,
  GridToolbarColumnsButton,
  GridToolbarFilterButton,
  GridToolbarDensitySelector,
  GridToolbarExport,
  GridToolbarQuickFilter
} from "@mui/x-data-grid";

import { ThemeProvider, createTheme } from "@mui/material/styles";
import { openOptyDetailsDrawer } from "./shared/OptyDetailsDrawer"; // <- the portal helper from before
import { Retrievers } from "./shared/retrievers";           // <- we already created this
import CloseIcon from "@mui/icons-material/Close";//[ts] Cannot find module '@mui/icons-material/Close' or its corresponding type declarations.
import OpenInNewIcon from "@mui/icons-material/OpenInNew";//[ts] Cannot find module '@mui/icons-material/OpenInNew' or its corresponding type declarations.

import { STAGE_COLORS, type OpportunityStage } from "./types/interfaces";
import { compactTheme } from "./theme/compactTheme";

type Contact = {
  name?: string | null;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
};

type Deadline = {
  original?: string;
  label?: "submission" | "delivery" | "milestone" | "meeting" | "other";
  when_iso?: string | null;
  confidence?: number;
};

export type JobRow = {
  id?: string;

  // linkage
  opty_id?: string | null;

  // core
  title?: string | null;
  company?: string | null;
  location?: string | null;
  platform?: string | null;
  external_id?: string | null;
  url?: string | null;

  // dates
  post_date?: string | null;
  saved_at?: string | null;

  // arrays
  skills?: string[];
  deliverables?: string[];

  // legacy/derived
  compensation_fixed?: string | null;
  compensation_hourly?: string | null;

  // contacts & deadlines (legacy JSONs if present)
  contacts?: Contact[] | null;
  deadlines?: Deadline[] | null;

  // pipeline / status
  funnel_stage?: string | null;
  proposal_status?: string | null;

  // money
  budget?: string | null;
  rate?: string | null;
  bid_amnt?: string | null;
  awarded_amnt?: string | null;

  // compensation v2
  comp_text?: string | null;
  comp_type?: string | null;
};


type PipelineState = {
  rows: JobRow[];
  loading: boolean;
  error: string | null;

  // UI state
  search: string;
  selected: JobRow | null;

  // filter by stage (color)
  stageFilter: "all" | OpportunityStage;
};


function coalesce(a: any, b: any): any {
  return a != null ? a : b;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function toNextDeadline(deadlines?: Deadline[] | null): { when: string | null; label: string | null } {
  if (!deadlines || !deadlines.length) return { when: null, label: null };
  var soon: Deadline | null = null;
  for (var i = 0; i < deadlines.length; i++) {
    var w = deadlines[i]?.when_iso ? new Date(String(deadlines[i].when_iso)) : null;
    if (!w || isNaN(w.getTime())) continue;
    if (soon == null) soon = deadlines[i];
    else {
      var ws = soon.when_iso ? new Date(String(soon.when_iso)) : null;
      if (ws && w.getTime() < ws.getTime()) soon = deadlines[i];
    }
  }
  if (!soon) return { when: null, label: null };
  return { when: soon.when_iso || null, label: soon.label || null };
}

function paySummary(row: JobRow): string {
  if (row.compensation_fixed) return String(row.compensation_fixed);
  if (row.compensation_hourly) return String(row.compensation_hourly);
  return "";
}

function onFilterModelChange(model: any): void {
  var v = (model && model.quickFilterValues && model.quickFilterValues[0]) || "";
  if (PipelineApp.instance) {
    PipelineApp.instance.setSearch(String(v));
  }
}

function getRowClassName(params: any): string {
  var r = params && params.row ? (params.row as JobRow) : null;
  var s = r && r.funnel_stage ? String(r.funnel_stage).toLowerCase() : "";
  if (s === "examining" || s === "applied" || s === "submitted" || s === "awarded" || s === "paid") {
    return "stage-" + s;
  }
  return "";
}

function onStageFilterChange(e: React.ChangeEvent<HTMLInputElement>): void {
  var v = (e && e.target && e.target.value) ? String(e.target.value) : "all";
  if (v !== "all" && v !== "examining" && v !== "applied" && v !== "submitted" && v !== "awarded" && v !== "paid") {
    v = "all";
  }
  if (PipelineApp.instance) {
    PipelineApp.instance.setStageFilter(v as any);
  }
}
// ----------- Toolbar Class ---------------

type StageToolbarProps = {
  stageFilter: "all" | OpportunityStage;
  onStageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

class GridToolbarWithStage extends React.Component<StageToolbarProps> {
  render(): React.ReactNode {
    var items: React.ReactNode[] = [
      <MenuItem key="all" value="all">
        <Box sx={{ width: 12, height: 12, borderRadius: "3px", bgcolor: "#fafafa", mr: 1, border: "1px solid #e0e0e0", display:"inline-block" }} />
        All stages
      </MenuItem>
    ];

    var stages: OpportunityStage[] = ["examining", "applied", "submitted", "awarded", "paid"];
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      items.push(
        <MenuItem key={s} value={s}>
          <Box sx={{ width: 12, height: 12, borderRadius: "3px", bgcolor: STAGE_COLORS[s], mr: 1, border: "1px solid #e0e0e0", display:"inline-block" }} />
          {s}
        </MenuItem>
      );
    }

    return (
      <GridToolbarContainer sx={{paddingTop:"10px"}}>
        <GridToolbarColumnsButton />
        <GridToolbarFilterButton />
        <GridToolbarDensitySelector />
        <GridToolbarExport />

        <Box sx={{ flex: 1 }} />

        <TextField
          size="small"
          label="Stage"
          select
          value={this.props.stageFilter}
          onChange={this.props.onStageChange}
          sx={{ minWidth: 180, mr: 1 }}
        >
          {items}
        </TextField>

        <GridToolbarQuickFilter sx={{ minWidth: 160, mr: 30 }} quickFilterParser={function (v: string): string[] { return [v]; }} />
      </GridToolbarContainer>
    );
  }
}

function onDrawerClosed(): void {

  if (PipelineApp.instance) {
    try {
      if (typeof _onOptyClose === "function") _onOptyClose();
    } catch (e) {}
    PipelineApp.instance.loadData();
  }
}

// ---------- Module-level handlers (avoid binding/arrow) ----------
class PipelineApp extends React.Component<{}, PipelineState> {
  static instance: PipelineApp | null = null;

  constructor(props: {}) {
    super(props);
    this.state = {
      rows: [],
      loading: true,
      error: null,
      search: "",
      selected: null,
      stageFilter: "all"
    };
  }

  componentDidMount(): void {
    PipelineApp.instance = this;
    this.loadData();
  }

  componentWillUnmount(): void {
    if (PipelineApp.instance === this) PipelineApp.instance = null;
  }

  loadData(): void {
    var self = this;
    self.setState({ loading: true, error: null });
    // Ask the SW for up to 200 jobs
    chrome.runtime
      .sendMessage({ type: "jobs/list", limit: 200 })
      .then(function (res: any) {
        if (!res || !res.ok) throw new Error(res?.error || "load failed");
        var data = Array.isArray(res.data) ? res.data : [];
        self.setState({ rows: data, loading: false, error: null });
      })
      .catch(function (e: any) {
        self.setState({ loading: false, error: String(e && e.message ? e.message : e) });
      });
  }

  // Instance methods invoked by module-level handlers
  setStageFilter(v: "all" | OpportunityStage): void {
    this.setState({ stageFilter: v });
  }
  setSearch(v: string): void {
    this.setState({ search: v });
  }

  render(): React.ReactNode {
    var cols: GridColDef<JobRow>[] = [
      { field: "title", headerName: "Title", flex: 1.4, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.title) || ""; }
      },
      { field: "company", headerName: "Company", flex: 1, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.company) || ""; }
      },
      { field: "location", headerName: "Location", width: 160, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.location) || ""; }
      },
      { field: "platform", headerName: "Platform", width: 140, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.platform) || ""; }
      },

      // { field: "saved_at", headerName: "Saved", width: 160, sortable: true,
      //   valueGetter: function (params: any) { return (params.row && params.row.saved_at) || ""; },
      //   valueFormatter: function (params: any): string { return fmtDate(params.value || ""); }
      // },
      // { field: "post_date", headerName: "Posted", width: 160, sortable: true,
      //   valueGetter: function (params: any) { return (params.row && params.row.post_date) || ""; },
      //   valueFormatter: function (params: any): string { return fmtDate(params.value || ""); }
      // },

      { field: "funnel_stage", headerName: "Stage", width: 0, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.funnel_stage) || ""; }
      },
      // { field: "proposal_status", headerName: "Status", width: 140, sortable: true,
      //   valueGetter: function (params: any) { return (params.row && params.row.proposal_status) || ""; }
      // },

      // prefer comp_text; fallback to derived summary
      { field: "pay", headerName: "Pay", width: 200, sortable: false,
        valueGetter: function (params: any) {
          var r = params.row as JobRow;
          if (r && r.comp_text) return String(r.comp_text);
          if (r && r.comp_type) return String(r.comp_type);
          return (r && paySummary(r)) || "";
        }
      },

      // { field: "next_deadline", headerName: "Next deadline", width: 200, sortable: true,
      //   valueGetter: function (params: any) {
      //     var nd = toNextDeadline((params.row && params.row.deadlines) || []);
      //     return nd.when || "";
      //   },
      //   valueFormatter: function (params: any): string { return fmtDate(params.value || ""); }
      // },
      // Convenience: show linkage presence
      // { field: "opty", headerName: "Linked", width: 100, sortable: false,
      //   valueGetter: function (params: any) { return (params.row && params.row.opty_id) ? "Linked" : ""; }
      // },
      // --- Hidden but available fields (toggle via column menu) ---
      { field: "budget", headerName: "Budget", width: 140, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.budget) || ""; }
      },
      { field: "rate", headerName: "Rate", width: 120, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.rate) || ""; }
      },
      { field: "bid_amnt", headerName: "Bid", width: 120, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.bid_amnt) || ""; }
      },
      { field: "awarded_amnt", headerName: "Awarded", width: 140, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.awarded_amnt) || ""; }
      },
      { field: "external_id", headerName: "External ID", width: 180, sortable: true,
        valueGetter: function (params: any) { return (params.row && params.row.external_id) || ""; }
      },
      { field: "url", headerName: "URL", width: 220, sortable: false,
        valueGetter: function (params: any) { return (params.row && params.row.url) || ""; }
      }
    ];


    // DataGrid quick filter: feed it with search state
    var quickFilterValues = this.state.search ? [this.state.search] : [];

    return (
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <Box sx={{ flex: 1, minHeight: 0 }}>
              <DataGrid
                rows={this.state.rows}
                columns={cols}
                getRowId={function (r) { return (r as JobRow).id || Math.random().toString(36).slice(2); }}
                loading={this.state.loading}
                disableRowSelectionOnClick
                onRowClick={onRowClick}
                slots={{ toolbar: GridToolbarWithStage }}
                slotProps={{
                  toolbar: {
                    stageFilter: this.state.stageFilter,
                    onStageChange: onStageFilterChange
                  }
                }}

                getRowClassName={getRowClassName}

                sx={{
                  "& .stage-examining": { backgroundColor: STAGE_COLORS.examining },
                  "& .stage-applied":   { backgroundColor: STAGE_COLORS.applied },
                  "& .stage-submitted": { backgroundColor: STAGE_COLORS.submitted },
                  "& .stage-awarded":   { backgroundColor: STAGE_COLORS.awarded },
                  "& .stage-paid":      { backgroundColor: STAGE_COLORS.paid },

                  "& .MuiDataGrid-row": {
                    outline: "0 solid transparent",
                    outlineOffset: "-2px",
                    transition: "outline-color 120ms ease, outline-width 120ms ease",
                    cursor: "pointer"
                  },
                  "& .MuiDataGrid-row:hover": { outline: "2px solid #9e9e9e" },
                  "& .MuiDataGrid-row.Mui-selected": { outline: "2px solid #616161" }
                }}




                // Filtering model: quick text + stage filter
                filterModel={{
                  items: this.state.stageFilter !== "all"
                    ? [{ id: 1, field: "funnel_stage", operator: "equals", value: this.state.stageFilter }]
                    : [],
                  quickFilterValues: this.state.search ? [this.state.search] : []
                }}
                onFilterModelChange={onFilterModelChange}
                initialState={{
                  columns: {
                    columnVisibilityModel: {
                      budget: false,
                      rate: false,
                      bid_amnt: false,
                      awarded_amnt: false,
                      external_id: false,
                      url: false,
                      status: false,
                      company: false
                    }
                  }
                }}
              />

          </Box>
        </Box>
    );
  }
}

// ---------- External handlers (no arrow, no bind) ----------
function onRowClick(params: GridRowParams<JobRow>): void {
  var row = params && (params.row as JobRow);

  if (!row) return;
  // Fallback: if no opty, just show overview with no deadlines
  if (!row.opty_id) { openOptyDetailsDrawer(row as any, [], onDrawerClosed); return; }
  // If we have a store, pull events filtered by opty_id
  if (_store && typeof _store.fetchEventsByOptyId === 'function') {
    // use current store range if any (the method defaults to internal range)
    _store.fetchEventsByOptyId(String(row.opty_id)).then(function (events: any[]) {
      openOptyDetailsDrawer(row as any, Array.isArray(events) ? events : [], onDrawerClosed);
    }).catch(function () {
      openOptyDetailsDrawer(row as any, [], onDrawerClosed); // graceful fallback
    });
  } else {
    openOptyDetailsDrawer(row as any, [], onDrawerClosed); // no store available
  }
}

function onSearchChange(e: React.ChangeEvent<HTMLInputElement>): void {
  if (PipelineApp.instance) {
    PipelineApp.instance.setSearch(e.target.value || "");
  }
}


// ---------- Mount API ----------
let _store: any = null; // CalendarStore
let _onOptyClose: (() => void) | null = null;
export function initPipeline(mountSelector: string, deps?: { calendarStore?: any; onOptyClose?: () => void }): void {

  _store = deps && deps.calendarStore ? deps.calendarStore : null;
  _onOptyClose = deps && deps.onOptyClose ? deps.onOptyClose : null;
  var el = document.querySelector(mountSelector) as HTMLElement | null;
  if (!el) return;
  var root: any;
  if ((ReactDOM as any).createRoot) {
    root = (ReactDOM as any).createRoot(el);
    root.render(
      React.createElement(
        ThemeProvider as any,
        { theme: compactTheme },               // use the imported theme directly
        React.createElement(PipelineApp, null)
      )
    );
  } else {
    (ReactDOM as any).render(
      React.createElement(
        ThemeProvider as any,
        { theme: compactTheme },
        React.createElement(PipelineApp, null)
      ),
      el
    );
  }
}
