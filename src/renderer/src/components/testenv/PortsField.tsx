import { useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';

type Port = { container: number; host: number };

// One port number: free typing (it may be empty for a moment); a valid port is saved as typed,
// anything else goes back to the last valid one on blur.
function PortInput({
  disabled,
  error,
  onChange,
  title,
  value
}: {
  disabled?: boolean;
  error?: boolean;
  onChange: (port: number) => void;
  title?: string;
  value: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      size="small"
      value={draft ?? String(value)}
      disabled={disabled}
      error={error || (draft !== null && portValue(draft) === null)}
      title={title}
      onChange={event => {
        const text = event.target.value.replace(/\D/g, '').slice(0, 5);
        setDraft(text);
        const port = portValue(text);
        if (port !== null) onChange(port);
      }}
      onBlur={() => setDraft(null)}
      slotProps={{ htmlInput: { inputMode: 'numeric' } }}
      sx={{ width: 110 }}
    />
  );
}

const portValue = (text: string) => {
  const number = Number(text);
  return Number.isInteger(number) && number > 0 && number <= 65535 ? number : null;
};

/** Published ports, host → container (TCP). Changing them recreates the host's container. */
export function PortsField({ disabled, onChange, ports, taken }: { disabled?: boolean; onChange: (ports: Port[]) => void; ports: Port[]; taken: Set<number> }) {
  const set = (index: number, field: keyof Port, value: number) => onChange(ports.map((port, at) => (at === index ? { ...port, [field]: value } : port)));
  const free = () => {
    let host = 8080;
    while (taken.has(host) || ports.some(port => port.host === host)) host += 1;
    return host;
  };
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: 'text.muted', mb: 0.5 }}>Ports (this computer → container)</Typography>
      <Stack spacing={0.75}>
        {ports.map((port, index) => {
          const clash = taken.has(port.host) || ports.some((other, at) => at !== index && other.host === port.host);
          return (
            <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <PortInput
                value={port.host}
                disabled={disabled}
                error={clash}
                title={clash ? 'Already published by another host' : undefined}
                onChange={value => set(index, 'host', value)}
              />
              <Typography sx={{ color: 'text.muted' }}>→</Typography>
              <PortInput value={port.container} disabled={disabled} onChange={value => set(index, 'container', value)} />
              <IconButton size="small" title="Remove port" disabled={disabled} onClick={() => onChange(ports.filter((_port, at) => at !== index))}>
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Stack>
          );
        })}
      </Stack>
      <Button
        size="small"
        startIcon={<AddIcon />}
        disabled={disabled}
        onClick={() => onChange([...ports, { host: free(), container: 80 }])}
        sx={{ mt: 0.5, textTransform: 'none' }}
      >
        Port
      </Button>
    </Box>
  );
}
