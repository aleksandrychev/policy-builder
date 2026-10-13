import type { CSSProperties } from 'react';

// Multi-line fields sized by Chromium (CSS field-sizing) instead of MUI's TextareaAutosize, which
// re-measures after every render, forcing a layout of the page: ~200 ms opening a 150-block file.
// Use both: `slotProps={{ input: plainTextarea, htmlInput: { style: contentSized(1, 6) } }}`.
export const plainTextarea = { inputComponent: 'textarea' } as const;

export const contentSized = (minRows: number, maxRows: number): CSSProperties => ({
  fieldSizing: 'content',
  minHeight: `${minRows}lh`,
  maxHeight: `${maxRows}lh`
});
