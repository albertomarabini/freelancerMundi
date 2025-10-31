import * as React from 'react';
import { Root, createRoot } from 'react-dom/client';
import * as ReactDOM from "react-dom/client";
import { Drawer, AppBar, Toolbar, IconButton, Typography, Box } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { ThemeProvider } from "@mui/material/styles";
import { compactTheme } from "./theme/compactTheme";
import { initPipeline } from "./pipeline"; // we will mount into an inner div

type Props = { open: boolean; onClose(): void; calendarStore?: any; onOptyClose?: () => void };
type State = {};

class PipelineBottomDrawer extends React.Component<Props, State> {
  private hostId: string;
  private _mountTimer: number | null = null;
  private _mountTries: number = 0;
  private _mounted: boolean = false;


  public constructor(props: Props) {

    super(props);
    this.hostId = "pipeline-host-" + Math.random().toString(36).slice(2);
  }

  componentDidMount(): void {
    this._mounted = true;
    this.tryMountPipeline();
  }

  private tryMountPipeline(): void {
    const sel = "#" + this.hostId;
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      initPipeline(sel, { calendarStore: this.props.calendarStore, onOptyClose: this.props.onOptyClose });
      if(this._mountTimer) window.clearTimeout(this._mountTimer);
      return;
    }
    // host not in DOM yet → retry a few times
    if (this._mountTries < 30) {
      this._mountTries++;
      this._mountTimer = window.setTimeout(() => this.tryMountPipeline(), 16); // ~1 frame
    } else {
      console.warn("Pipeline host not found after retries:", sel);
    }
  }

  componentWillUnmount(): void {
    this._mounted = false;
    if (this._mountTimer != null) {
      window.clearTimeout(this._mountTimer);
      this._mountTimer = null;
    }
  }

  public render(): React.ReactNode {
    return React.createElement(ThemeProvider as any, { theme: compactTheme },
      React.createElement(Drawer, {
        anchor: "bottom",
        open: this.props.open,
        onClose: this.props.onClose,
        ModalProps: { keepMounted: true },
        PaperProps: { sx: { height: '50vh' } }
      },
        React.createElement(Box, {
          sx: { position: "absolute", inset: 0, display: 'flex', flexDirection: 'column' }
        },
          // top strip (matches calendar)
          React.createElement('div', {
            id: 'pipeline-drawer-strip',
            onClick: this.props.onClose,
            style: {
              height: '1.7rem',
              lineHeight: '1.7rem',
              background: '#fff',
              borderTop: '1px solid #e0e0e0',
              borderBottom: '1px solid #e0e0e0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 8px',
              userSelect: 'none',
              fontSize: '1.2rem',
              fontWeight: 500,
              cursor: 'pointer'
            }
          },
            'Pipeline',
            React.createElement(IconButton, {
              size: "small",
              color: 'error',
              sx: { ml: 1 }
            }, React.createElement(CloseIcon, null))
          ),
          // content area (fills the rest)
          React.createElement('div', { style: { flex: '1 1 auto', minHeight: 0 } },
            React.createElement("div", {
              id: this.hostId,
              style: { width: "100%", height: "100%" }
            })
          )
        )
      )
    );
  }
}

let root: Root | null = null;
export function openPipelineDrawer(deps: { calendarStore?: any, onOptyClose?: () => void}) {
  const host = document.getElementById("pipeline-bottom-drawer-root") || (function () {
    const d = document.createElement("div"); d.id = "pipeline-bottom-drawer-root"; document.body.appendChild(d); return d;
  })();
  if (!root) root = ReactDOM.createRoot(host);
  function close() { if (root) root.render(null); }
  root.render(React.createElement(PipelineBottomDrawer, { open: true, onClose: close, calendarStore: deps.calendarStore, onOptyClose: deps.onOptyClose}));
}
export function closePipelineDrawer(): void {
  if (root) {
    root.render(null);   // unmounts the drawer
  }
}

