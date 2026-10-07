import type { Theme } from '@mui/material';

// Distinct hues (the theme's primary and secondary are both navy): readable on light and dark.
const LIGHT = ['#2563eb', '#7c3aed', '#0d9488', '#c2410c', '#be185d', '#4d7c0f'];
const DARK = ['#60a5fa', '#a78bfa', '#2dd4bf', '#fb923c', '#f472b6', '#a3e635'];

// A steady colour per host (by position), for its log tag and selection chips.
export function hostColor(theme: Theme, index: number): string {
  const palette = theme.palette.mode === 'dark' ? DARK : LIGHT;
  return palette[index % palette.length];
}
