import { useEffect, useRef, useState } from 'react';

import VerifiedIcon from '@mui/icons-material/Verified';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';

import { PLATFORMS, type PlatformSupport } from '../../store/testEnvironmentsSlice/types';

type Api = NonNullable<Window['api']>;
type Search = Awaited<ReturnType<Api['testEnvSearch']>>;
type TestEnvEvent = Parameters<Parameters<Api['onTestEnvEvent']>[0]>[1];
type Option = { description?: string; group: string; name: string; official?: boolean; stars?: number };
type Check =
  | { message: string; progress: number | null; state: 'checking' }
  | { message: string; state: 'failed' }
  | { os: string | null; platform: string | null; state: 'done' }
  | { state: 'idle' };

const optionsOf = (found: Search | null): Option[] => [
  ...(found?.local ?? []).map(name => ({ name, group: 'On this machine' })),
  ...(found?.hub ?? []).map(item => ({ ...item, name: `${item.name}:latest`, group: 'Docker Hub' }))
];

export interface CustomImageDialogProps {
  arch: string;
  onAdd: (image: string, platform: string) => void;
  onClose: () => void;
  support: PlatformSupport | null;
}

/** Adds a client host on any Docker image: picked from pulled ones or Docker Hub, its OS checked for a CFEngine package. */
export function CustomImageDialog({ arch, onAdd, onClose, support }: CustomImageDialogProps) {
  const [image, setImage] = useState('');
  const [found, setFound] = useState<Search | null>(null);
  const [searching, setSearching] = useState(false);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [platform, setPlatform] = useState('');
  const run = useRef<string | null>(null);
  const term = image.split(/[:@]/)[0].trim();

  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      setSearching(true);
      window.api
        ?.testEnvSearch({ term, hub: term.length >= 2 })
        .then(result => current && setFound(result))
        .catch(() => current && setFound(null))
        .finally(() => current && setSearching(false));
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [term]);

  // Stop a check still pulling when the dialog goes away.
  useEffect(
    () => () => {
      if (run.current) void window.api?.cancelTestEnvRun(run.current);
    },
    []
  );

  const startCheck = async () => {
    if (!window.api) return;
    setCheck({ state: 'checking', message: `Checking ${image}…`, progress: null });
    // Events can arrive before the run id does; keep them until it's known.
    const early: [string, TestEnvEvent][] = [];
    const onEvent = (event: TestEnvEvent) => {
      if (event.t === 'progress') setCheck(c => (c.state === 'checking' ? { ...c, progress: event.total ? (event.current * 100) / event.total : null } : c));
      else if (event.t === 'step') setCheck(c => (c.state === 'checking' ? { ...c, message: event.message } : c));
      else if (event.t === 'detected') {
        setCheck({ state: 'done', os: event.os, platform: event.platform });
        setPlatform(event.platform ?? '');
      } else if (event.t === 'error') setCheck({ state: 'failed', message: event.message });
      else if (event.t === 'exit') {
        unsubscribe();
        run.current = null;
        if (!event.ok) setCheck(c => (c.state === 'failed' ? c : { state: 'failed', message: event.message ?? 'The check failed' }));
      }
    };
    const unsubscribe = window.api.onTestEnvEvent((runId, event) =>
      run.current === null ? early.push([runId, event]) : runId === run.current && onEvent(event)
    );
    try {
      run.current = await window.api.testEnvStart('inspect', { image: image.trim(), arch });
      early.filter(([runId]) => runId === run.current).forEach(([, event]) => onEvent(event));
    } catch (error) {
      unsubscribe();
      setCheck({ state: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const missing = (id: string) => Boolean(support?.[id] && !support[id].client);
  const valid = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/.test(image.trim());
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add a host from another image</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Autocomplete
            freeSolo
            options={optionsOf(found)}
            groupBy={option => option.group}
            getOptionLabel={option => (typeof option === 'string' ? option : option.name)}
            filterOptions={options => options}
            inputValue={image}
            onInputChange={(_event, value) => {
              setImage(value);
              setCheck({ state: 'idle' });
            }}
            loading={searching}
            disabled={check.state === 'checking'}
            renderOption={({ key, ...props }, option) => (
              <li key={key} {...props}>
                <Stack sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <Typography sx={{ fontSize: 14, fontFamily: 'monospace' }}>{option.name}</Typography>
                    {option.official && <VerifiedIcon color="primary" sx={{ fontSize: 14 }} titleAccess="Docker official image" />}
                    {option.stars !== undefined && <Typography sx={{ fontSize: 11, color: 'text.muted' }}>★ {option.stars}</Typography>}
                  </Stack>
                  {option.description && (
                    <Typography sx={{ fontSize: 12, color: 'text.muted', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {option.description}
                    </Typography>
                  )}
                </Stack>
              </li>
            )}
            renderInput={params => (
              <TextField
                {...params}
                autoFocus
                label="Image"
                placeholder="rockylinux:9, registry.example.com/base/rhel9:1.2"
                helperText={found?.hubError ?? 'Search Docker Hub or type any image reference; set the tag you need.'}
              />
            )}
          />
          {check.state === 'checking' && (
            <Stack spacing={0.5}>
              <Typography sx={{ fontSize: 13 }}>{check.message}</Typography>
              <LinearProgress variant={check.progress === null ? 'indeterminate' : 'determinate'} value={check.progress ?? 0} />
            </Stack>
          )}
          {check.state === 'failed' && <Alert severity="error">{check.message}</Alert>}
          {check.state === 'done' && (
            <>
              <Alert severity={check.platform ? 'success' : 'warning'}>
                {check.platform
                  ? `${check.os ?? 'This image'}: takes the ${PLATFORMS.find(p => p.id === check.platform)?.label} package.`
                  : `${check.os ?? 'This image'} isn't a platform CFEngine has packages for. Pick the closest one, e.g. the distribution it's based on.`}
              </Alert>
              <TextField select size="small" label="Install the CFEngine package for" value={platform} onChange={event => setPlatform(event.target.value)}>
                {PLATFORMS.map(item => (
                  <MenuItem key={item.id} value={item.id} disabled={missing(item.id)}>
                    {item.label}
                    {missing(item.id) && <Typography sx={{ fontSize: 11, color: 'text.muted', ml: 1 }}>no package</Typography>}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {check.state === 'done' ? (
          <Button variant="contained" disabled={!platform || missing(platform)} onClick={() => onAdd(image.trim(), platform)}>
            Add host
          </Button>
        ) : (
          <Button
            variant="contained"
            disabled={!valid || check.state === 'checking'}
            onClick={() => void startCheck()}
            title="Pulls the image and reads its OS"
          >
            Check image
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
