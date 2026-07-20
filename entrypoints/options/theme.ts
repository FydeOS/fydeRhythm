import { createTheme } from '@mui/material/styles';

// Brand crimson — identical in both color schemes.
const brand = 'rgba(228, 0, 70, 1)';

export default createTheme({
  // Emit CSS variables switched by a `.light` / `.dark` class on <html>, which
  // MUI's `useColorScheme` sets from the persisted mode (light / dark / system).
  // Every `theme.vars.*` token and every `sx` palette string resolves to a var
  // that flips with that class. The plain CSS/Less surfaces key off the same
  // class (see global.css, styles.module.less) so they stay in lock-step.
  cssVariables: {
    colorSchemeSelector: 'class',
  },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: brand },
        background: {
          default: '#ffffff',
          paper: '#ffffff',
        },
        text: {
          primary: '#1A1A24',
        },
        divider: 'rgba(0, 0, 0, 0.08)',
      },
    },
    dark: {
      palette: {
        primary: { main: brand },
        background: {
          // Matches the ChromeOS dark surface used by the candidate window.
          default: '#202124',
          paper: '#28292d',
        },
        text: {
          primary: '#E8EAED',
          secondary: '#BDC1C6',
        },
        divider: 'rgba(255, 255, 255, 0.12)',
      },
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        contained: {
          'borderRadius': 12,
          'padding': '8px 24px',
          'backgroundColor': brand,
          'fontSize': '13px',
          'lineHeight': '22px',
          'textTransform': 'unset',
          'fontWeight': 500,
          'boxShadow': '0 2px 8px rgba(228, 0, 70, 0.2)',
          'transition': 'background-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
          '&:hover': {
            backgroundColor: 'rgba(228, 0, 70, .85)',
            boxShadow: '0 4px 12px rgba(228, 0, 70, 0.3)',
          },
        },
        outlined: ({ theme }) => ({
          'borderRadius': 12,
          'padding': '8px 24px',
          'borderColor': theme.vars.palette.divider,
          'fontSize': '13px',
          'lineHeight': '22px',
          'textTransform': 'unset',
          'fontWeight': 500,
          'color': theme.vars.palette.text.primary,
          'transition': 'background-color 0.2s ease-in-out, border-color 0.2s ease-in-out',
          '&:hover': {
            borderColor: 'rgba(228, 0, 70, .5)',
            backgroundColor: 'rgba(228, 0, 70, 0.04)',
          },
        }),
        text: {
          color: brand,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          'borderRadius': 8,
          'fontSize': '13px',
          'lineHeight': '22px',
          '& .MuiOutlinedInput-notchedOutline': {
            transition: 'border-color 0.2s ease-in-out',
          },
          '&.Mui-focused': {
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgba(228, 0, 70, 1)',
            },
          },
          '&:hover': {
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: 'rgba(228, 0, 70, 0.5)',
            },
          },
        },
      },
    },
    MuiFilledInput: {
      styleOverrides: {
        root: ({ theme }) => ({
          'borderRadius': 12,
          'backgroundColor': theme.vars.palette.action.hover,
          'transition': 'background-color 0.2s ease-in-out',
          '&:hover': {
            backgroundColor: theme.vars.palette.action.selected,
          },
          '&.Mui-focused': {
            backgroundColor: theme.vars.palette.action.hover,
          },
          '&::before, &::after': {
            display: 'none',
          },
          'input': {
            padding: '24px 16px 8px',
            fontSize: '13px',
            lineHeight: '22px',
            fontWeight: 500,
            color: theme.vars.palette.text.primary,
          },
        }),
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          'fontSize': '13px',
          'transform': 'translate(16px, 12px) scale(1)',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(16px, -8px) scale(0.85)',
            fontWeight: 600,
          },
          '&.Mui-focused': {
            color: 'rgba(228, 0, 70, 1)',
          },
        },
        filled: {
          'transform': 'translate(16px, 16px) scale(1)',
          '&.MuiInputLabel-shrink': {
            transform: 'translate(16px, 5px) scale(0.75)',
          },
        },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          'padding': '0',
          'paddingRight': '7.5px',
          'paddingLeft': '0 !important',
          '&.Mui-checked': {
            color: 'rgba(228, 0, 70, 1)',
          },
          '&+.MuiTypography-root': {
            fontSize: '14px',
            lineHeight: '22px',
          },
          '& .MuiSvgIcon-root': {
            width: '18px',
          },
        },
      },
    },
    MuiRadio: {
      styleOverrides: {
        root: {
          '&.Mui-checked': {
            color: 'rgba(228, 0, 70, 1)',
          },
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        track: ({ theme }) => ({
          backgroundColor: 'rgba(0, 0, 0, 0.38)',
          ...theme.applyStyles('dark', {
            backgroundColor: 'rgba(255, 255, 255, 0.3)',
          }),
        }),
        switchBase: {
          '&.Mui-checked': {
            color: 'rgba(228, 0, 70, 1)',
          },
          '&.Mui-checked + .MuiSwitch-track': {
            backgroundColor: 'rgba(228, 0, 70, 1)',
            opacity: 0.5,
          },
          '&.Mui-disabled': {
            color: 'rgba(0, 0, 0, 0.38)',
          },
          '&.Mui-disabled + .MuiSwitch-track': {
            backgroundColor: 'rgba(0, 0, 0, 0.26)',
            opacity: 1,
          },
          '&.Mui-disabled.Mui-checked': {
            color: 'rgba(228, 0, 70, 0.5)',
          },
          '&.Mui-disabled.Mui-checked + .MuiSwitch-track': {
            backgroundColor: 'rgba(228, 0, 70, 0.2)',
            opacity: 1,
          },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(228, 0, 70, 0.1)',
        },
        bar: {
          backgroundColor: 'rgba(228, 0, 70, 1)',
        },
      },
    },
    MuiInput: {
      styleOverrides: {
        root: {
          'borderWidth': '1px',
          '&::after': {
            borderColor: '#E40046',
            borderWidth: '1px',
          },
          'input': {
            height: '22px',
            fontSize: '13px',
            lineHeight: '22px',
            padding: '1px 0',
          },
        },
      },
    },
    MuiFormControlLabel: {
      styleOverrides: {
        root: {
          marginLeft: '0 !important',
          marginRight: '20px !important',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        // Match the 20px formBox card radius; keep the fullScreen editor square.
        paper: ({ ownerState }) => ({
          ...(ownerState.fullScreen ? {} : { borderRadius: 20 }),
        }),
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontWeight: 600,
          fontSize: '16px',
          color: theme.vars.palette.text.primary,
          letterSpacing: '-0.01em',
        }),
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: '8px 24px 20px',
        },
      },
    },
    MuiTooltip: {
      defaultProps: {
        enterDelay: 400,
        // Match the pill's slide timing so the label feels part of the control.
        TransitionProps: { timeout: 180 },
      },
      styleOverrides: {
        tooltip: ({ theme }) => ({
          backgroundColor: '#1A1A24',
          color: '#ffffff',
          fontSize: '12px',
          fontWeight: 500,
          lineHeight: '16px',
          padding: '6px 10px',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.16), 0 1px 4px rgba(0, 0, 0, 0.12)',
          ...theme.applyStyles('dark', { backgroundColor: '#3c3c44' }),
        }),
        arrow: ({ theme }) => ({
          color: '#1A1A24',
          ...theme.applyStyles('dark', { color: '#3c3c44' }),
        }),
      },
    },
    MuiSnackbarContent: {
      styleOverrides: {
        // Inverted surface in both schemes: a near-black chip on light, a light
        // chip on dark, so the toast always contrasts against the page.
        root: ({ theme }) => ({
          borderRadius: 14,
          backgroundColor: '#1A1A24',
          padding: '6px 8px 6px 20px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.12)',
          minWidth: 'unset',
          flexWrap: 'nowrap',
          gap: '8px',
          ...theme.applyStyles('dark', {
            backgroundColor: '#3c3c44',
          }),
        }),
        message: {
          fontSize: '13px',
          fontWeight: 500,
          color: '#ffffff',
          padding: '6px 0',
        },
        action: {
          paddingLeft: '4px',
          marginRight: 0,
        },
      },
    },
  },
});
