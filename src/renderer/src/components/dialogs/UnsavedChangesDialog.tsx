import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';

interface UnsavedChangesDialogProps {
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  projectName: string;
}

/** Save / Don't Save / Cancel, before something replaces or closes a project with unsaved changes. */
export function UnsavedChangesDialog({ projectName, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Save changes to “{projectName}”?</DialogTitle>
      <DialogContent>
        <DialogContentText>Your changes will be lost if you don’t save them.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="primary" onClick={onDiscard} sx={{ mr: 'auto' }}>
          Don’t Save
        </Button>
        <Button variant="text" color="primary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="contained" color="primary" onClick={onSave} autoFocus>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
