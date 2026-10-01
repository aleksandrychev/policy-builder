import { useState } from 'react';

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack
} from '@mui/material';

import type { Project, ProjectType } from '../../store/projectSlice/types';
import { ProjectTypeField } from './ProjectTypeField';

interface ProjectSettingsDialogProps {
  // The latest 3.27.x masterfiles release, for a module that becomes a policy set.
  latestMasterfiles: string;
  onClose: () => void;
  // Saves the project in the new shape; resolves with whether that worked.
  onTypeChange: (type: ProjectType, masterfiles: string | null) => Promise<boolean>;
  project: Project;
}

/** Project-wide settings: how the project is stored. Changing it converts cfbs.json on Save. */
export function ProjectSettingsDialog({ latestMasterfiles, onClose, onTypeChange, project }: ProjectSettingsDialogProps) {
  const [type, setType] = useState<ProjectType>(project.type);
  const [masterfiles, setMasterfiles] = useState<'latest' | 'master'>('latest');
  const [saving, setSaving] = useState(false);
  // A policy set needs masterfiles; a module doesn't bring any.
  const needsMasterfiles = type === 'policy-set' && project.type === 'module' && !project.masterfiles;
  const changed = type !== project.type;

  const apply = async () => {
    if (!changed) return onClose();
    setSaving(true);
    const version = needsMasterfiles ? (masterfiles === 'master' ? 'master' : latestMasterfiles) : null;
    if (await onTypeChange(type, version)) onClose();
    else setSaving(false);
  };

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Project Settings</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <ProjectTypeField value={type} onChange={setType} disabled={saving} />
          {needsMasterfiles && (
            <FormControl disabled={saving}>
              <FormLabel id="settings-masterfiles-label" sx={{ fontSize: 14 }}>
                Which version of masterfiles would you like to use?
              </FormLabel>
              <RadioGroup
                aria-labelledby="settings-masterfiles-label"
                value={masterfiles}
                onChange={event => setMasterfiles(event.target.value as 'latest' | 'master')}
              >
                <FormControlLabel value="latest" control={<Radio size="small" />} label={`Latest (${latestMasterfiles})`} />
                <FormControlLabel value="master" control={<Radio size="small" />} label="Master branch" />
              </RadioGroup>
            </FormControl>
          )}
          {changed && project.path && (
            <Alert severity="info">
              {type === 'module'
                ? 'Saves the project as a module: cfbs.json provides it as one module instead of building it. Other build entries, masterfiles included, are kept.'
                : 'Saves the project as a policy set: cfbs.json builds it with masterfiles instead of providing it.'}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="primary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" color="primary" onClick={apply} disabled={saving} autoFocus>
          {changed && project.path ? 'Save' : 'Done'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
