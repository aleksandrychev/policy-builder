import { useState } from 'react';

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';

import { useAppDispatch } from '../../store';
import { projectFilesInitialized } from '../../store/filesSlice';
import { historyCleared } from '../../store/history';
import { projectCreated } from '../../store/projectSlice';

interface NewProjectDialogProps {
  onClose: () => void;
  open: boolean;
}

/**
 * Collects a project name and creates the project in memory. Nothing is
 * written to disk here — that happens later, when the project is saved.
 */
export function NewProjectDialog({ open, onClose }: NewProjectDialogProps) {
  const dispatch = useAppDispatch();
  const [name, setName] = useState('');

  const handleClose = () => {
    onClose();
    setName('');
  };

  const handleCreate = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    dispatch(projectCreated({ name: trimmedName }));
    // Every project starts with one policy file, named after the project —
    // each file has its own namespace (see architecture-plan.md), derived
    // from its own name.
    dispatch(projectFilesInitialized(trimmedName));
    dispatch(historyCleared());
    handleClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
      <DialogTitle>New Project</DialogTitle>
      <form
        onSubmit={event => {
          event.preventDefault();
          handleCreate();
        }}
      >
        <DialogContent>
          <Stack spacing={1} sx={{ pt: 1 }}>
            <TextField label="Project name" value={name} onChange={event => setName(event.target.value)} autoFocus fullWidth size="small" />
            <Typography sx={{ fontSize: 12, fontStyle: 'italic', color: 'text.muted' }}>
              This can’t be changed later — it also becomes the first policy file’s namespace.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="primary" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color="primary" disabled={!name.trim()}>
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
