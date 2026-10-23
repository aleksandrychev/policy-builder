import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';

const isMac = navigator.platform.startsWith('Mac');
// ⌘ on macOS, Ctrl elsewhere; ⇧ / Shift likewise.
const mod = (key: string, shift = false) => (isMac ? `${shift ? '⇧' : ''}⌘${key}` : `Ctrl+${shift ? 'Shift+' : ''}${key}`);

const SECTIONS: { rows: [keys: string, action: string][]; title: string }[] = [
  {
    title: 'Project',
    rows: [
      [mod('N'), 'New project'],
      [mod('O'), 'Open project'],
      [mod('S'), 'Save'],
      [mod(','), 'Project settings']
    ]
  },
  {
    title: 'Canvas',
    rows: [
      [mod('Z'), 'Undo'],
      [isMac ? mod('Z', true) : 'Ctrl+Y', 'Redo'],
      [`${mod('X')}  ${mod('C')}  ${mod('V')}`, 'Cut, copy, paste a block'],
      [isMac ? '⌫' : 'Delete', 'Delete the selection'],
      [mod('A'), 'Select every block'],
      [isMac ? '⇧ drag' : 'Shift+drag', 'Select blocks in an area'],
      [mod('G'), 'Group the selection'],
      [mod('G', true), 'Ungroup'],
      ['Esc', 'Clear the selection']
    ]
  },
  {
    title: 'View',
    rows: [
      [`${mod('1')} … ${mod('4')}`, 'Canvas, Generated Policy, Tests & Logs, Deployment'],
      [mod('B'), 'Show or hide the side bar'],
      [mod('E', true), 'Blocks and files'],
      [mod('X', true), 'Modules'],
      [`+  or  ${mod('=')}`, 'Zoom in'],
      [`-  or  ${mod('-')}`, 'Zoom out'],
      [`0  or  ${mod('0')}`, 'Actual size'],
      ['1', 'Fit to view']
    ]
  }
];

/** Help > Keyboard Shortcuts: the keys the menus and the canvas answer to. */
export function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Keyboard shortcuts</DialogTitle>
      <DialogContent>
        {SECTIONS.map(section => (
          <Box key={section.title} sx={{ mb: 2 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted', mb: 0.5 }}>{section.title.toUpperCase()}</Typography>
            {section.rows.map(([keys, action]) => (
              <Box key={action} sx={{ display: 'flex', gap: 2, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
                <Typography sx={{ width: 180, flexShrink: 0, fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre' }}>{keys}</Typography>
                <Typography sx={{ fontSize: 13 }}>{action}</Typography>
              </Box>
            ))}
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
