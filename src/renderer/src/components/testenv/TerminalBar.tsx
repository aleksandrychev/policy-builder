import { type RefObject, useState } from 'react';

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Button, InputAdornment, Stack, TextField } from '@mui/material';

import type { TestHost } from '../../store/testEnvironmentsSlice/types';
import { HostTabs } from './HostTabs';

/** Runs a shell command on the chosen hosts (none chosen: all); the output goes into the log. */
export function TerminalBar({
  disabled,
  hosts,
  inputRef,
  onRun,
  onSelect,
  selected
}: {
  disabled: boolean;
  hosts: TestHost[];
  inputRef?: RefObject<HTMLInputElement | null>;
  onRun: (command: string, hosts: string[]) => void;
  onSelect: (hosts: string[]) => void;
  // The hosts to run on; none for all.
  selected: string[];
}) {
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [back, setBack] = useState(-1);
  const run = () => {
    const text = command.trim();
    if (!text || disabled) return;
    onRun(text, selected);
    setHistory(current => [text, ...current.filter(item => item !== text)].slice(0, 50));
    setBack(-1);
    setCommand('');
  };
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
      <HostTabs allLabel="All hosts" hosts={hosts} multiple selected={selected} onChange={onSelect} />
      <TextField
        size="small"
        fullWidth
        sx={{ minWidth: 200 }}
        value={command}
        inputRef={inputRef}
        placeholder="Command to run, e.g. /var/cfengine/bin/cf-agent -KI"
        onChange={event => setCommand(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') run();
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            const next = Math.max(-1, Math.min(history.length - 1, back + (event.key === 'ArrowUp' ? 1 : -1)));
            setBack(next);
            setCommand(next === -1 ? '' : history[next]);
            event.preventDefault();
          }
        }}
        slotProps={{
          htmlInput: { style: { fontFamily: 'monospace', fontSize: 13 }, spellCheck: false },
          input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }
        }}
      />
      <Button variant="contained" startIcon={<PlayArrowIcon />} disabled={disabled || !command.trim()} onClick={run}>
        Run
      </Button>
    </Stack>
  );
}
