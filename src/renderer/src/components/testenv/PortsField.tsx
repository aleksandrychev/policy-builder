import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material';

type Port = { container: number; host: number };

const portValue = (text: string) => {
  const number = Number(text);
  return Number.isInteger(number) && number > 0 && number <= 65535 ? number : null;
};

/** Published ports, host → container (TCP). Changing them recreates the host's container. */
export function PortsField({ disabled, onChange, ports, taken }: { disabled?: boolean; onChange: (ports: Port[]) => void; ports: Port[]; taken: Set<number> }) {
  const set = (index: number, field: keyof Port, text: string) => {
    const value = portValue(text);
    if (value !== null) onChange(ports.map((port, at) => (at === index ? { ...port, [field]: value } : port)));
  };
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
              <TextField
                size="small"
                type="number"
                value={port.host}
                disabled={disabled}
                error={clash}
                title={clash ? 'Already published by another host' : undefined}
                onChange={event => set(index, 'host', event.target.value)}
                sx={{ width: 110 }}
              />
              <Typography sx={{ color: 'text.muted' }}>→</Typography>
              <TextField
                size="small"
                type="number"
                value={port.container}
                disabled={disabled}
                onChange={event => set(index, 'container', event.target.value)}
                sx={{ width: 110 }}
              />
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
