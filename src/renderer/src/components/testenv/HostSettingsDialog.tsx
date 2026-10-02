import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';

import { PLATFORMS, type PlatformSupport, type TestHost } from '../../store/testEnvironmentsSlice/types';
import { EnvVarsField } from './EnvVarsField';
import { PortsField } from './PortsField';

export interface HostSettingsDialogProps {
  busy: boolean;
  canRemove: boolean;
  exists: boolean;
  host: TestHost;
  isHub: boolean;
  onChange: (changes: Partial<Pick<TestHost, 'env' | 'platform' | 'ports'>>) => void;
  onClose: () => void;
  onMakeHub: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
  onReset: () => void;
  // Host ports other hosts publish.
  otherPorts: Set<number>;
  // Which platforms have packages for this edition, version and architecture (null: unknown).
  support: PlatformSupport | null;
}

/** A host's settings: name, platform, role, ports and environment variables; Reset and Remove. */
export function HostSettingsDialog(props: HostSettingsDialogProps) {
  const { host, isHub, busy } = props;
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm">
      <DialogTitle>Host settings</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1.5}>
            <TextField
              label="Name"
              size="small"
              value={host.name}
              disabled={busy}
              onChange={event => props.onRename(event.target.value)}
              helperText="Letters, digits and dashes"
              slotProps={{ htmlInput: { maxLength: 40 } }}
              sx={{ flex: 1 }}
            />
            <TextField
              select
              label="Platform"
              size="small"
              value={host.platform}
              disabled={busy}
              onChange={event => props.onChange({ platform: event.target.value })}
              sx={{ flex: 1.4 }}
            >
              {PLATFORMS.map(platform => {
                const known = props.support?.[platform.id];
                const missing = known && !(isHub ? known.hub : known.client);
                return (
                  <MenuItem key={platform.id} value={platform.id} disabled={Boolean(missing)}>
                    {platform.label}
                    {missing && (
                      <Typography component="span" sx={{ fontSize: 11, color: 'text.muted', ml: 1 }}>
                        {isHub && known.client ? 'no hub package' : 'no package'}
                      </Typography>
                    )}
                  </MenuItem>
                );
              })}
            </TextField>
          </Stack>
          <Stack spacing={0.5}>
            <Typography sx={{ fontSize: 12, color: 'text.muted' }}>Role</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={isHub ? 'hub' : 'client'}
              disabled={busy}
              onChange={(_event, value) => value === 'hub' && props.onMakeHub()}
            >
              <ToggleButton value="hub" sx={{ textTransform: 'none', px: 2 }}>
                Hub — serves the policy
              </ToggleButton>
              <ToggleButton value="client" disabled={isHub} sx={{ textTransform: 'none', px: 2 }}>
                Client
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <PortsField ports={host.ports} taken={props.otherPorts} disabled={busy} onChange={ports => props.onChange({ ports })} />
          <EnvVarsField label="Environment variables (this host)" env={host.env} onChange={env => props.onChange({ env })} />
          <Typography sx={{ fontSize: 12, color: 'text.muted' }}>Changing the platform or ports recreates the container on the next run.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1}>
          <Button color="error" disabled={busy || !props.canRemove} onClick={props.onRemove}>
            Remove host
          </Button>
          <Button disabled={busy || !props.exists} onClick={props.onReset} title="Remove the container; the next run creates it fresh">
            Reset
          </Button>
        </Stack>
        <Button variant="contained" onClick={props.onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}
