import { Box, ButtonBase, alpha, useTheme } from '@mui/material';

import type { TestHost } from '../../store/testEnvironmentsSlice/types';
import { hostColor } from './hostColors';

/**
 * Segmented host picker: "All" plus one tab per host. Single choice for the log;
 * several for the terminal (`multiple`), where none chosen means all.
 */
export function HostTabs({
  allLabel,
  hosts,
  multiple,
  onChange,
  selected
}: {
  allLabel: string;
  hosts: TestHost[];
  multiple?: boolean;
  onChange: (selected: string[]) => void;
  selected: string[];
}) {
  const theme = useTheme();
  const all = selected.length === 0;
  const toggle = (id: string) => {
    if (!multiple) return onChange([id]);
    const next = selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id];
    onChange(next.length === hosts.length ? [] : next);
  };
  const tab = (key: string, label: string, active: boolean, onClick: () => void, color?: string) => (
    <ButtonBase
      key={key}
      onClick={onClick}
      sx={{
        px: 1.5,
        py: 0.5,
        borderRadius: 1,
        fontSize: 13,
        fontWeight: active ? 700 : 400,
        color: active ? 'text.primary' : 'text.secondary',
        bgcolor: active ? 'background.paper' : 'transparent',
        boxShadow: active ? 1 : 0,
        whiteSpace: 'nowrap',
        gap: 0.75
      }}
    >
      {color && <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: color }} />}
      {label}
    </ButtonBase>
  );
  return (
    <Box sx={{ display: 'inline-flex', gap: 0.25, p: 0.25, borderRadius: 1.5, bgcolor: alpha(theme.palette.text.primary, 0.06) }}>
      {tab('all', allLabel, all, () => onChange([]))}
      {hosts.map((host, index) => tab(host.id, host.name, !all && selected.includes(host.id), () => toggle(host.id), hostColor(theme, index)))}
    </Box>
  );
}
