import type { ReactNode } from 'react';

import { CssBaseline, GlobalStyles, type Theme, type ThemeOptions, ThemeProvider, createTheme } from '@mui/material';

import { dark, light } from '@northern.tech/themes/CFEngine';

import { useColorScheme } from './hooks/useColorScheme';

const outlinedFields = {
  components: {
    MuiTextField: { defaultProps: { variant: 'outlined' as const } },
    MuiFormControl: { defaultProps: { variant: 'outlined' as const } },
    MuiSelect: { defaultProps: { variant: 'outlined' as const } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& input, &input:focus': {
            padding: '8px 14px',
            margin: 0,
            border: 'none !important',
            boxShadow: 'none',
            color: 'inherit'
          }
        }
      }
    }
  }
};

// The CFEngine theme sizes text fields for Mission Portal: full width, and a fixed 40px height
// that helper text overflows onto the next field. Ours size themselves (merging can't drop it).
function appTheme(base: ThemeOptions): Theme {
  const theme = createTheme(base, outlinedFields);
  return { ...theme, components: { ...theme.components, MuiTextField: { ...theme.components?.MuiTextField, styleOverrides: {} } } };
}

const themes = { light: appTheme(light), dark: appTheme(dark) };

/**
 * Applies the CFEngine MUI theme (from the shared @northern.tech/themes
 * package), following the OS light/dark preference.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  return (
    <ThemeProvider theme={themes[scheme]}>
      <CssBaseline />
      <GlobalStyles styles={{ html: { fontSize: '62.5%' } }} />
      {children}
    </ThemeProvider>
  );
}
