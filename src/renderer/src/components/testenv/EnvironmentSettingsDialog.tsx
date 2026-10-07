import { Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';

import type { TestEnvironment } from '../../store/testEnvironmentsSlice/types';
import { EnvVarsField } from './EnvVarsField';
import { useDraft } from './useDraft';

export interface EnvironmentSettingsDialogProps {
  busy: boolean;
  canDestroy: boolean;
  // The Docker engine's own architecture, when known (another one is emulated).
  engineArch?: string;
  environment: TestEnvironment;
  onChange: (changes: Partial<Pick<TestEnvironment, 'arch' | 'edition' | 'envFile' | 'maxRuns' | 'name' | 'version'>>) => void;
  onClose: () => void;
  onDestroy: () => void;
  onEnvChange: (env: Record<string, string>) => void;
  // A .env file needs a project folder.
  saved: boolean;
}

/** What every host shares: CFEngine edition, version and architecture, and environment variables. */
export function EnvironmentSettingsDialog(props: EnvironmentSettingsDialogProps) {
  const { environment, busy, onChange } = props;
  const emulated = Boolean(props.engineArch) && props.engineArch !== environment.arch;
  // Text is committed on blur: one undo step per edit (and one platform lookup per version).
  const name = useDraft(environment.name, text => {
    if (text !== environment.name) onChange({ name: text });
  });
  const version = useDraft(environment.version, text => {
    const value = text.trim() || 'latest';
    if (value !== environment.version) onChange({ version: value });
  });
  const envFile = useDraft(environment.envFile ?? '', text => {
    const value = text.trim() || null;
    if (value !== environment.envFile) onChange({ envFile: value });
  });
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>Test environment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Name" size="small" value={name.value} onChange={event => name.setDraft(event.target.value)} onBlur={name.flush} />
          <Stack direction="row" spacing={1.5}>
            <TextField
              select
              label="Edition"
              size="small"
              value={environment.edition}
              disabled={busy}
              onChange={event => onChange({ edition: event.target.value as TestEnvironment['edition'] })}
              helperText={environment.edition === 'enterprise' ? 'The hub runs Mission Portal (publish port 443)' : ' '}
              sx={{ flex: 1.3 }}
            >
              <MenuItem value="community">Community</MenuItem>
              <MenuItem value="enterprise">Enterprise</MenuItem>
            </TextField>
            <TextField
              select
              label="Architecture"
              size="small"
              value={environment.arch}
              disabled={busy}
              onChange={event => onChange({ arch: event.target.value as TestEnvironment['arch'] })}
              helperText={emulated ? 'Emulated by Docker (slower)' : 'Native'}
              sx={{ flex: 1 }}
            >
              <MenuItem value="x86_64">x86-64</MenuItem>
              <MenuItem value="aarch64">arm64</MenuItem>
            </TextField>
            <TextField
              label="CFEngine version"
              size="small"
              value={version.value}
              disabled={busy}
              onChange={event => version.setDraft(event.target.value)}
              onBlur={version.flush}
              helperText="latest, or e.g. 3.27.1"
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            select
            label="Agent runs per Deploy & run"
            size="small"
            value={environment.maxRuns ?? 3}
            disabled={busy}
            onChange={event => onChange({ maxRuns: Number(event.target.value) })}
            helperText="At most this many per host: runs repeat until one repairs nothing (later runs settle what earlier ones changed)."
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(count => (
              <MenuItem key={count} value={count}>
                {count === 1 ? '1 (a single run)' : `Up to ${count}`}
                {count === 3 ? ' (default)' : ''}
              </MenuItem>
            ))}
          </TextField>
          <EnvVarsField label="Environment variables (all hosts)" env={environment.env} onChange={props.onEnvChange} />
          <TextField
            label="Secrets file (.env), optional"
            size="small"
            value={envFile.value}
            placeholder="./.env"
            disabled={!props.saved}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText={
              props.saved
                ? 'A file in the project folder with KEY=value lines (e.g. ./.env). The hosts get them as environment variables, like the ones above; they’re read at every run and never stored in the project or git, so put secrets there. Commits from here add it to .gitignore.'
                : 'Save the project to use one: the path is relative to its folder.'
            }
            onChange={event => envFile.setDraft(event.target.value)}
            onBlur={envFile.flush}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Button color="error" disabled={busy || !props.canDestroy} onClick={props.onDestroy} title="Remove every container of this environment">
          Destroy containers
        </Button>
        <Button variant="contained" onClick={props.onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
