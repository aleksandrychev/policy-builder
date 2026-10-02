import { useEffect, useRef, useState } from 'react';

import { Box, Button, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';

import type { LogLine } from '../../project/testRuns';
import type { TestHost } from '../../store/testEnvironmentsSlice/types';

/** The environment's streamed log: every host or one, setup and/or agent output. */
export function LogPane({ hosts, lines, onClear }: { hosts: TestHost[]; lines: LogLine[]; onClear: () => void }) {
  const [host, setHost] = useState('all');
  const [kinds, setKinds] = useState<string[]>(['setup', 'agent']);
  const end = useRef<HTMLDivElement | null>(null);
  const nameOf = new Map(hosts.map(item => [item.id, item.name]));
  const shown = lines.filter(
    line => (host === 'all' || !line.host || line.host === host) && (line.kind === 'step' || line.kind === 'error' || kinds.includes(line.kind))
  );

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [shown.length]);

  const text = shown.map(line => `${line.host ? `[${nameOf.get(line.host) ?? line.host}] ` : ''}${line.text}`).join('\n');

  return (
    <Stack sx={{ minHeight: 0, flex: 1 }} spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography sx={{ fontSize: 14, fontWeight: 600 }}>Log</Typography>
        <TextField select size="small" value={host} onChange={event => setHost(event.target.value)} sx={{ width: 150 }}>
          <MenuItem value="all">All hosts</MenuItem>
          {hosts.map(item => (
            <MenuItem key={item.id} value={item.id}>
              {item.name}
            </MenuItem>
          ))}
        </TextField>
        <ToggleButtonGroup size="small" value={kinds} onChange={(_event, value: string[]) => setKinds(value)}>
          <ToggleButton value="setup" sx={{ textTransform: 'none', py: 0.25 }}>
            Setup
          </ToggleButton>
          <ToggleButton value="agent" sx={{ textTransform: 'none', py: 0.25 }}>
            Agent
          </ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button size="small" disabled={!text} onClick={() => void navigator.clipboard.writeText(text)} sx={{ textTransform: 'none' }}>
          Copy
        </Button>
        <Button size="small" disabled={lines.length === 0} onClick={onClear} sx={{ textTransform: 'none' }}>
          Clear
        </Button>
      </Stack>
      <Box
        sx={{
          flex: 1,
          minHeight: 200,
          overflow: 'auto',
          bgcolor: 'background.code',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 1,
          fontFamily: 'monospace',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {shown.length === 0 && <Typography sx={{ fontSize: 12, color: 'text.muted' }}>Nothing yet: Start the environment, then Run policy.</Typography>}
        {shown.map((line, index) => (
          <Box
            key={index}
            sx={{
              color:
                line.kind === 'error' ? 'error.main' : line.kind === 'step' ? 'primary.light' : line.text.startsWith('R: ') ? 'success.main' : 'text.primary',
              fontWeight: line.kind === 'step' ? 600 : 400
            }}
          >
            {line.host && (
              <Box component="span" sx={{ color: 'text.muted' }}>
                [{nameOf.get(line.host) ?? line.host}]{' '}
              </Box>
            )}
            {line.text}
          </Box>
        ))}
        <div ref={end} />
      </Box>
    </Stack>
  );
}
