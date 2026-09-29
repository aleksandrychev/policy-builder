import { useMemo, useState } from 'react';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import { Box, ButtonBase, InputAdornment, TextField, Typography } from '@mui/material';

import { useDraggable } from '@dnd-kit/core';

import { blockDescriptors, groupBlocksByCategory } from '../blocks/loadBlocks';
import { PROMISE_TYPE_ICONS } from '../blocks/promiseTypeIcons';
import { primaryPromiseType } from '../blocks/resolveBlockShape';
import type { BlockDescriptor } from '../blocks/types';

// Namespaced so ProjectView's onDragEnd can tell a palette drag (add) apart
// from a canvas-card drag (reorder), which uses bare instanceIds.
export const paletteDragId = (blockId: string) => `palette:${blockId}`;

function BlockRow({ block, onAdd }: { block: BlockDescriptor; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: paletteDragId(block.id),
    data: { source: 'palette', block }
  });
  const promiseType = primaryPromiseType(block);
  const TypeIcon = promiseType ? PROMISE_TYPE_ICONS[promiseType] : undefined;

  return (
    <Box
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onAdd}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 1.25,
        py: 0.75,
        borderRadius: '4px',
        cursor: 'grab',
        userSelect: 'none',
        opacity: isDragging ? 0.5 : 1,
        '&:hover': { bgcolor: 'background.default' }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        {TypeIcon && <TypeIcon sx={{ fontSize: 15, color: 'text.muted', flexShrink: 0 }} />}
        <Typography sx={{ fontSize: 13, color: 'text.primary' }}>{block.name}</Typography>
      </Box>
      <Typography sx={{ fontSize: 10, fontFamily: 'monospace', color: 'text.muted', opacity: 0.7, flexShrink: 0 }}>{promiseType}</Typography>
    </Box>
  );
}

function CategoryGroup({ category, blocks, onAdd }: { blocks: BlockDescriptor[]; category: string; onAdd: (block: BlockDescriptor) => void }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Box>
      <ButtonBase
        onClick={() => setCollapsed(current => !current)}
        aria-expanded={!collapsed}
        sx={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.75, borderRadius: '4px' }}
      >
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>{category}</Typography>
        <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.muted', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }} />
      </ButtonBase>
      {!collapsed && (
        <Box sx={{ pl: 1 }}>
          {blocks.map(block => (
            <BlockRow key={block.id} block={block} onAdd={() => onAdd(block)} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export function BlockPalette({ onAddBlock }: { onAddBlock: (block: BlockDescriptor) => void }) {
  const [search, setSearch] = useState('');

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? blockDescriptors.filter(block => block.name.toLowerCase().includes(query) || block.description?.toLowerCase().includes(query))
      : blockDescriptors;
    return groupBlocksByCategory(filtered);
  }, [search]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Box sx={{ p: 2, pb: 1 }}>
        <Box sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>Blocks</Typography>
        </Box>
        <TextField
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search blocks…"
          variant="standard"
          fullWidth
          size="small"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 16, color: 'text.muted' }} />
                </InputAdornment>
              )
            }
          }}
        />
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1, py: 1 }}>
        {groups.size === 0 && <Typography sx={{ fontSize: 13, color: 'text.muted', textAlign: 'center', mt: 2 }}>No blocks match “{search}”.</Typography>}
        {[...groups.entries()].map(([category, blocks]) => (
          <CategoryGroup key={category} category={category} blocks={blocks} onAdd={onAddBlock} />
        ))}
      </Box>
    </Box>
  );
}
