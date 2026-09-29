import { useState } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { Box, Button, IconButton, ListItemText, Menu, MenuItem, Stack, TextField, Typography } from '@mui/material';

import { decorators } from '../../blocks/decorators';
import type { DecoratorInstance } from '../../store/canvasSlice/types';
import { ParameterField } from './paramFields';

export function DecoratorRow({
  decoratorInstance,
  index,
  count,
  onParamChange,
  onRemove,
  onMoveUp,
  onMoveDown
}: {
  count: number;
  decoratorInstance: DecoratorInstance;
  index: number;
  onMoveDown: () => void;
  onMoveUp: () => void;
  onParamChange: (paramName: string, value: string) => void;
  onRemove: () => void;
}) {
  const decorator = decorators.find(candidate => candidate.id === decoratorInstance.decoratorId);
  if (!decorator) return null;

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '4px', p: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: decorator.parameters.length ? 1 : 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.primary' }}>{decorator.label}</Typography>
          {decorator.badge && <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'text.muted' }}>{decorator.badge}</Typography>}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <IconButton size="small" aria-label="Move step up" disabled={index === 0} onClick={onMoveUp}>
            <KeyboardArrowUpIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton size="small" aria-label="Move step down" disabled={index === count - 1} onClick={onMoveDown}>
            <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton size="small" aria-label="Remove step" onClick={onRemove}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>
      {decorator.parameters.length > 0 && (
        <Stack spacing={1}>
          {decorator.parameters.map(parameter => (
            <ParameterField
              key={parameter.name}
              parameter={parameter}
              value={decoratorInstance.params[parameter.name] ?? String(parameter.default ?? '')}
              onChange={value => onParamChange(parameter.name, value)}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

const DECORATOR_GROUPS: { label: string; note: string; type: 'slist' | 'string' }[] = [
  { type: 'string', label: 'String transforms', note: 'Convert back to a string first — Join into a string, Pick entry by index, or Count entries.' },
  { type: 'slist', label: 'List transforms', note: 'Convert to a list first with “Split into a list”.' }
];

export function AddDecoratorButton({ chainType, onAdd }: { chainType: 'slist' | 'string'; onAdd: (decoratorId: string) => void }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const matches = (decorator: (typeof decorators)[number]) =>
    !query || decorator.label.toLowerCase().includes(query) || decorator.badge?.toLowerCase().includes(query);

  return (
    <>
      <Button
        size="small"
        startIcon={<AddIcon />}
        onClick={event => {
          setAnchorEl(event.currentTarget);
          setSearch('');
        }}
        sx={{ alignSelf: 'flex-start' }}
      >
        Add transform
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <Box sx={{ px: 1.5, pb: 0.5 }}>
          <TextField
            autoFocus
            size="small"
            variant="standard"
            placeholder="Search transforms…"
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => event.stopPropagation()}
            fullWidth
          />
        </Box>
        {DECORATOR_GROUPS.flatMap(group => {
          const items = decorators.filter(decorator => decorator.input_type === group.type && matches(decorator));
          if (items.length === 0) return [];
          const enabled = group.type === chainType;
          return [
            <Box key={`${group.type}-header`} sx={{ px: 1.5, pt: 1, pb: 0.25 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>{group.label}</Typography>
              {!enabled && <Typography sx={{ fontSize: 10, color: 'text.muted', fontStyle: 'italic' }}>{group.note}</Typography>}
            </Box>,
            ...items.map(decorator => (
              <MenuItem
                key={decorator.id}
                disabled={!enabled}
                onClick={() => {
                  onAdd(decorator.id);
                  setAnchorEl(null);
                }}
              >
                <ListItemText primary={decorator.label} />
                {decorator.badge && <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: 'text.muted', ml: 1 }}>{decorator.badge}</Typography>}
              </MenuItem>
            ))
          ];
        })}
      </Menu>
    </>
  );
}
