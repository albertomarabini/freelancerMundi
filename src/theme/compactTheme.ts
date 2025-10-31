// src/theme/compactTheme.ts
import { createTheme } from '@mui/material/styles';
import type {} from "@mui/x-data-grid/themeAugmentation";

export const compactTheme = createTheme({
  spacing: 4,
  typography: {
    fontSize: 18,
    htmlFontSize: 18,
    button: { textTransform: 'none' },
  },
  shape: { borderRadius: 8 },

  components: {
    MuiDataGrid: {
      styleOverrides: {
        root: {
          // covers builds that read a CSS var for row hover
          // (harmless if unused)
          "--DataGrid-rowHoverBackground": "inherit"
        },
        row: {
          "&.Mui-hovered, &:hover": { backgroundColor: "inherit !important" },
          "&:hover .MuiDataGrid-cell": { backgroundColor: "inherit !important" }
        },
        cell: {
          "&.Mui-hovered, &:hover": { backgroundColor: "inherit !important" }
        }
      }
    },
    /* ---- Inputs/TextFields (outlined, small, dense) ---- */
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'small',
        // InputLabelProps: { shrink: true },
        // InputProps: { notched: true },
      },
    },
    MuiFormControl: {
      defaultProps: { size: 'small', margin: 'dense' },
    },

    /* Labels: always shrink in compact mode */
    MuiInputLabel: {
      defaultProps: { shrink: true },
      styleOverrides: {
        root: {
          top: '3px',
          fontSize: '1.0rem',
          transformOrigin: 'top left'
        },
        outlined: {
          /* UN-SHRUNK (empty, unfocused) → nudge upward */
          '&:not(.MuiInputLabel-shrink)': {
            // default is roughly translate(14px, 16px) scale(1)
            // move up so it doesn't sit too low in compact height
            transform: 'translate(14px, 7px) scale(1)',
          },
          '&.MuiInputLabel-sizeSmall:not(.MuiInputLabel-shrink)': {
            transform: 'translate(14px, 5px) scale(1)',
          },

          /* SHRUNK (focused/filled) → your existing tweak */
          '&.MuiInputLabel-shrink': {
            // default is ~ translate(14px, -9px) scale(0.75)
            // nudge a tad higher to clear compact outline
            transform: 'translate(14px, -11px) scale(0.75)',
            fontWeight: 700,
          },
          // keep small variant in sync
          '&.MuiInputLabel-shrink.MuiInputLabel-sizeSmall': {
            transform: 'translate(14px, -11px) scale(0.75)',
            fontWeight: 700,
          },
        },
      },
    },

    /* Core input height & paddings (applies to TextField and Select with outlined) */
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          // match text + select heights
          minHeight: 30,
          '&.MuiInputBase-sizeSmall': { minHeight: 30 },
        },
        input: {
          paddingTop: '0.5rem',
          paddingBottom: 0,
          paddingLeft: 8,
          paddingRight: 8,
          lineHeight: 1.3,
        },
        notchedOutline: {
          borderWidth: 1,
          '& legend': {
            // ensure the legend actually reserves space for the label text
            width: 'auto',
            maxWidth: '1000px',
          },
          '& legend > span': {
            // tiny padding keeps the notch from clipping letters like “g/j/y”
            paddingLeft: 12,
            paddingRight: 12,
          },
        },
      },
    },

    /* Base input defaults (covers some non-outlined fallbacks) */
    MuiInputBase: {
      styleOverrides: {
        root: {
          fontSize: '0.9rem',
          '&.MuiInputBase-sizeSmall': { minHeight: 30 },
        },
      },
    },

    /* ---- Select specifics (so it’s not taller than TextField) ---- */
    MuiSelect: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        // The clickable chip/area inside the outlined input
        select: {
          paddingTop: 2,
          paddingBottom: 0,
          paddingLeft: 8,
          paddingRight: 28,
          lineHeight: 2.4,
          minHeight: 0,
        },
        outlined: { minHeight: 30 },
        icon: { top: 'calc(50% - 10px)', right: 6 },
      },
    },

    /* ---- Menu density for dropdowns ---- */
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 28,
          paddingTop: 4,
          paddingBottom: 4,
          fontSize: '0.9rem',
        },
      },
    },

    /* ---- Small bits ---- */
    MuiButton: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { padding: '4px 10px', minHeight: 28 } },
    },
    MuiCheckbox: { defaultProps: { size: 'small' } },
    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { height: 22 } },
    },
    MuiDialogTitle: { styleOverrides: { root: { padding: '8px 12px', fontSize:"1.25rem", fontWeight:"600" } } },
    MuiDialogContent: { styleOverrides: { root: { padding: 12, fontSize:"1rem"  } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '8px 12px', fontSize:"1rem" } } },
    MuiFormControlLabel: {
      styleOverrides: { label: { fontSize: '0.85rem' } },
    },
  },
});
