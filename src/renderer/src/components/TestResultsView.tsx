import { useCallback, useEffect, useState } from 'react';

import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';

type Api = NonNullable<Window['api']>;
type DockerStatus = Awaited<ReturnType<Api['testEnvDoctor']>>;
type BaseImage = Awaited<ReturnType<Api['testEnvImages']>>['platforms'][number];
type TestEnvEvent = Parameters<Parameters<Api['onTestEnvEvent']>[0]>[1];

interface Pull {
  current: number;
  error?: string;
  line?: string;
  runId: string;
  total: number;
}

const percentOf = ({ current, total }: Pull) => (total ? Math.round((current * 100) / total) : 0);

/**
 * The Test Results & Logs tab. So far: whether Docker is usable, and the base
 * images test hosts run (pulled ahead of time, with progress). Hosts, roles,
 * ports and runs come next (see the test-environments plan).
 */
export function TestResultsView() {
  const [status, setStatus] = useState<DockerStatus | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [images, setImages] = useState<BaseImage[]>([]);
  // By image.
  const [pulls, setPulls] = useState<Record<string, Pull>>({});

  // Bumped to check Docker again (Retry / Refresh, and after a pull).
  const [checks, setChecks] = useState(0);
  const check = useCallback(() => setChecks(count => count + 1), []);

  useEffect(() => {
    let current = true;
    window.api
      ?.testEnvDoctor()
      .then(async next => {
        const platforms = next.available ? (await window.api!.testEnvImages()).platforms : [];
        if (!current) return;
        setCheckError(null);
        setStatus(next);
        setImages(platforms);
      })
      .catch((error: unknown) => current && setCheckError(error instanceof Error ? error.message : String(error)));
    return () => {
      current = false;
    };
  }, [checks]);

  useEffect(
    () =>
      window.api?.onTestEnvEvent((runId: string, event: TestEnvEvent) => {
        setPulls(current => {
          const image = Object.keys(current).find(key => current[key].runId === runId);
          if (!image) return current;
          const pull = current[image];
          if (event.t === 'progress') return { ...current, [image]: { ...pull, current: event.current, total: event.total } };
          if (event.t === 'log') return { ...current, [image]: { ...pull, line: event.line } };
          if (event.t !== 'exit') return current;
          const { [image]: _done, ...rest } = current;
          return event.ok ? rest : { ...rest, [image]: { ...pull, runId: '', error: event.message ?? 'Pull failed' } };
        });
        if (event.t === 'exit' && event.ok) check();
      }),
    [check]
  );

  if (!window.api) return <Placeholder text="Test environments need the desktop app." />;
  const api = window.api;

  const pull = async (image: string) => {
    const runId = await api.testEnvPull(image);
    setPulls(current => ({ ...current, [image]: { runId, current: 0, total: 0 } }));
  };

  return (
    <Box component="main" sx={{ flex: 1, minWidth: 0, overflowY: 'auto', p: 3 }}>
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Box>
          <Typography sx={{ fontSize: 18, fontWeight: 700 }}>Test environments</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.muted' }}>
            Run the generated policy on Docker containers. Hosts, the hub, ports and runs come next; for now, check Docker and get the base images ready.
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            {status?.available ? <CheckCircleOutlineIcon color="success" /> : <WarningAmberIcon color={status ? 'warning' : 'disabled'} />}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                {checkError
                  ? 'Couldn’t check Docker'
                  : status
                    ? status.available
                      ? 'Docker is ready'
                      : status.problem === 'not_installed'
                        ? 'Docker isn’t installed'
                        : 'Docker isn’t running'
                    : 'Checking Docker…'}
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'text.muted' }}>{checkError ?? status?.message}</Typography>
              {status?.host && <Typography sx={{ fontSize: 11, color: 'text.muted', fontFamily: 'monospace' }}>{status.host}</Typography>}
            </Box>
            <Button size="small" onClick={check}>
              {status?.available ? 'Refresh' : 'Retry'}
            </Button>
          </Stack>
        </Paper>

        {status?.available && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 1 }}>Base images</Typography>
            <Stack spacing={1.5}>
              {images.map(image => {
                const running = pulls[image.image];
                return (
                  <Box key={image.id}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={{ fontSize: 13 }}>{image.label}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'text.muted', fontFamily: 'monospace' }}>{image.image}</Typography>
                      </Box>
                      <Chip size="small" variant="outlined" color={image.present ? 'success' : 'default'} label={image.present ? 'Pulled' : 'Not pulled'} />
                      {running?.runId ? (
                        <Button size="small" color="inherit" onClick={() => void api.cancelTestEnvRun(running.runId)}>
                          Cancel
                        </Button>
                      ) : (
                        <Button size="small" onClick={() => void pull(image.image)}>
                          {image.present ? 'Update' : 'Pull'}
                        </Button>
                      )}
                    </Stack>
                    {running?.runId && (
                      <Box sx={{ mt: 0.75 }}>
                        <LinearProgress variant={running.total ? 'determinate' : 'indeterminate'} value={percentOf(running)} />
                        <Typography sx={{ fontSize: 11, color: 'text.muted', mt: 0.25, fontFamily: 'monospace' }}>
                          {running.total ? `${percentOf(running)}% · ` : ''}
                          {running.line ?? 'Starting…'}
                        </Typography>
                      </Box>
                    )}
                    {running?.error && <Typography sx={{ fontSize: 12, color: 'error.main', mt: 0.5 }}>{running.error}</Typography>}
                  </Box>
                );
              })}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Typography sx={{ color: 'text.muted' }}>{text}</Typography>
    </Box>
  );
}
