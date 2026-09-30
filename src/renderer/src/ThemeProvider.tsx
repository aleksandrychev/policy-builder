import type { ReactNode } from 'react';

import { CssBaseline, GlobalStyles, ThemeProvider, createTheme } from '@mui/material';

import { dark, light } from '@northern.tech/themes/CFEngine';

import { useColorScheme } from './hooks/useColorScheme';

const outlinedFields = {
  components: {
    MuiTextField: {
      defaultProps: { variant: 'outlined' as const },
      styleOverrides: { root: {} }
    },
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

const themes = {
  light: createTheme(light, outlinedFields),
  dark: createTheme(dark, outlinedFields)
};

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
