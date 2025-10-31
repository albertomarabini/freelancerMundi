// src/CaptureDialog.tsx
import * as React from 'react';
import { Root, createRoot } from 'react-dom/client';
import * as ReactDOM from 'react-dom/client';
import { Dialog, IconButton, Box } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { ThemeProvider } from '@mui/material/styles';
import { compactTheme } from './theme/compactTheme';
import { CaptureApp } from './capture';

type Props = { open: boolean; onClose(): void; calendarStore: any; settings: any; };

class CaptureDialog extends React.Component<Props> {
  private captureRef: React.RefObject<CaptureApp>;
  private captureAttemptCount: number = 0;
  private captureInFlight: boolean = false;

  public constructor(props: Props) {
    super(props);
    this.captureRef = React.createRef<CaptureApp>();
  }
  public componentDidMount(): void {
    if (this.props.open) this.safeTriggerCapture();
  }
  public componentDidUpdate(prevProps: Props): void {
    if (!prevProps.open && this.props.open) {
      this.captureAttemptCount = 0;
      this.safeTriggerCapture();
    }
  }
  private safeTriggerCapture(): void {
    if (this.captureInFlight) return;
    this.captureInFlight = true;
    try {
      const comp = this.captureRef.current;
      if (!comp) {
        if (this.captureAttemptCount >= 10) {
          throw new Error('Failed to auto-capture: component ref not available');
        }
        this.captureInFlight = false;
        this.captureAttemptCount += 1;
        var delay = this.captureAttemptCount * 300 * (this.captureAttemptCount === 1 ? 1 : 3);
        const self = this;
        setTimeout(function () { self.safeTriggerCapture(); }, delay);
        return;
      }
      this.captureAttemptCount = 0;
      comp.onCapture();
    } catch (e) {
      console.error('Failed to auto-capture:', e);
    }
  }
  public render(): React.ReactNode {
    return React.createElement(
      ThemeProvider as any,
      { theme: compactTheme },
      React.createElement(
        Dialog,
        {
          open: this.props.open,
          onClose: this.props.onClose,
          fullScreen: false,
          PaperProps: {
            sx: {
              minWidth: '90%',
              minHeight: '90%',
              m: 'auto',
              position: 'relative',
              overflow: 'hidden',
            }
          }
        },
        // floating red close button (absolute)
        React.createElement(
          IconButton,
          {
            onClick: this.props.onClose,
            color: 'error',
            sx: {
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 10
            }
          },
          React.createElement(CloseIcon, null)
        ),
        // content fills the whole dialog
        React.createElement(
          Box,
          { sx: { width: '100%', height: '100%', p: 0, m: 0 } },
          React.createElement(CaptureApp, {
            ref: this.captureRef,
            calendarStore: this.props.calendarStore,
            settings: this.props.settings,
            onClose: this.props.onClose
          })
        )
      )
    );
  }
}

let root: Root | null = null;
export function openCaptureDialog(deps: { calendarStore: any; settings: any }) {
  const host =
    document.getElementById('capture-dialog-root') ||
    (function () {
      const d = document.createElement('div');
      d.id = 'capture-dialog-root';
      document.body.appendChild(d);
      return d;
    })();

  if (!root) root = ReactDOM.createRoot(host);

  function close() {
    if (root) root.render(null);
  }

  root.render(
    React.createElement(CaptureDialog, {
      open: true,
      onClose: close,
      calendarStore: deps.calendarStore,
      settings: deps.settings,
    })
  );
}
