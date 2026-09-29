// Text fields render on top of this panel's own filled background; without
// an explicit background they're the same shade as the panel and disappear.
// `background.input` exists in the theme for exactly this, but isn't wired
// to any global component style, so it's applied per-field here instead of
// in the (shared, do-not-restyle) theme itself.
export const inputSx = { '& .MuiInputBase-root': { bgcolor: 'background.input' }, '& .MuiFormHelperText-root': { fontSize: '12px' } };

// The shared theme makes Autocomplete fields borderless except while
// focused, gives the inner input its own compact padding, and tints it with
// a paper-toned background independent of the root background set above —
// fine for an Autocomplete that's already obviously interactive elsewhere in
// the app, but a lone one here just reads as a smaller, differently-shaded
// box than every plain TextField around it. Matching those properties
// locally rather than in the (shared, do-not-restyle) theme.
export const autocompleteSx = {
  ...inputSx,
  '& .MuiOutlinedInput-notchedOutline': { border: '1px solid', borderColor: 'divider' },
  '& .MuiAutocomplete-input': { background: 'transparent !important', padding: '8px 14px !important' }
};
