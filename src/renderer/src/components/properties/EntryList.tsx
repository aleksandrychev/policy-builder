import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CloseIcon from '@mui/icons-material/Close';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { Box, Button, IconButton, Stack, Typography } from '@mui/material';

import { entryName, entrySummary } from '../../blocks/definitionEntries';
import type { BlockDescriptor } from '../../blocks/types';
import type { DefinitionEntry } from '../../store/canvasSlice/types';
import { capitalize } from './capitalize';

// The overview of a multi-entry block: one row per entry, click to edit it.
export function EntryList({
  descriptor,
  entries,
  isDuplicate,
  onOpen,
  onAdd,
  onMove,
  onRemove
}: {
  descriptor: BlockDescriptor;
  entries: DefinitionEntry[];
  isDuplicate: (name: string) => boolean;
  onAdd: () => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onOpen: (entryId: string) => void;
  onRemove: (entryId: string) => void;
}) {
  const { noun, noun_plural } = descriptor.entries!;
  const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>
          {capitalize(noun_plural)} ({entries.length})
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={onAdd}>
          Add {noun}
        </Button>
      </Box>
      <Stack spacing={0.75}>
        {entries.map((entry, index) => {
          const name = entryName(descriptor, entry);
          const duplicate = Boolean(name) && isDuplicate(name);
          const flags = entry.condition ? 'has condition' : '';
          return (
            <Box
              key={entry.id}
              role="button"
              tabIndex={0}
              aria-label={`Edit ${name || `unnamed ${noun}`}`}
              onClick={() => onOpen(entry.id)}
              onKeyDown={event => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault();
                  onOpen(entry.id);
                }
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.25,
                border: '1px solid',
                borderColor: duplicate ? 'error.main' : 'divider',
                borderRadius: '4px',
                bgcolor: 'background.input',
                pl: 1.25,
                pr: 0.5,
                py: 0.75,
                cursor: 'pointer',
                '&:hover': { borderColor: duplicate ? 'error.main' : 'primary.main' }
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                {/* Wraps rather than truncates: the name is the one thing the row must show in full. */}
                <Typography
                  sx={{
                    fontSize: 13,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    color: duplicate ? 'error.main' : name ? 'text.primary' : 'text.muted',
                    overflowWrap: 'anywhere'
                  }}
                >
                  {name || `(unnamed ${noun})`}
                </Typography>
                <Typography sx={{ fontSize: 11, color: duplicate ? 'error.main' : 'text.muted', ...ellipsis }}>
                  {duplicate ? 'Name already used in this file' : entrySummary(descriptor, entry)}
                </Typography>
                {flags && <Typography sx={{ fontSize: 11, color: 'text.muted', fontStyle: 'italic' }}>{flags}</Typography>}
              </Box>
              <IconButton
                size="small"
                aria-label={`Move ${name || noun} up`}
                sx={{ p: 0.25 }}
                disabled={index === 0}
                onClick={event => {
                  event.stopPropagation();
                  onMove(index, index - 1);
                }}
              >
                <KeyboardArrowUpIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <IconButton
                size="small"
                aria-label={`Move ${name || noun} down`}
                sx={{ p: 0.25 }}
                disabled={index === entries.length - 1}
                onClick={event => {
                  event.stopPropagation();
                  onMove(index, index + 1);
                }}
              >
                <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <IconButton
                size="small"
                aria-label={`Remove ${name || noun}`}
                sx={{ p: 0.25 }}
                onClick={event => {
                  event.stopPropagation();
                  onRemove(entry.id);
                }}
              >
                <CloseIcon sx={{ fontSize: 16 }} />
              </IconButton>
              <ChevronRightIcon sx={{ fontSize: 18, color: 'text.muted' }} />
            </Box>
          );
        })}
      </Stack>
      <Typography sx={{ fontSize: 11, color: 'text.muted', mt: 0.75 }}>
        Order doesn&rsquo;t change the result — CFEngine resolves them over several passes.
      </Typography>
    </Box>
  );
}
