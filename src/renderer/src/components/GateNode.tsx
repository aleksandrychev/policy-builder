import { useState } from 'react';

import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { Box, Divider, IconButton, ListItemText, Menu, MenuItem, Typography, useTheme } from '@mui/material';

import { Handle, type Node, type NodeProps, Position, useStore } from '@xyflow/react';

import type { FileConditionRelation } from '../canvas/fileCondition';
import { GATE_WIDTH, type Gate } from '../canvas/gates';
import { COMPACT_ZOOM, type ConditionSource } from './BlockCard';
import { stopCanvasEvents } from './stopCanvasEvents';

export interface GateNodeData extends Record<string, unknown> {
  // How this gate relates to the file's own condition, if at all.
  fileRelation?: FileConditionRelation;
  gate: Gate;
  onHighlight: (instanceId: string | null) => void;
  onModeChange: (mode: 'if' | 'unless') => void;
  onRemove: () => void;
  source?: ConditionSource;
}

export type GateFlowNode = Node<GateNodeData, 'gate'>;

// Under the class name: how it relates to the file's condition, else which file defines the class.
function GateCaption({ fileRelation, fileLabel }: { fileLabel?: string; fileRelation?: FileConditionRelation }) {
  if (fileRelation) {
    return (
      <Typography sx={{ fontSize: 10, color: fileRelation === 'same' ? 'text.muted' : 'warning.main' }}>
        {fileRelation === 'same' ? 'already required by the file' : 'file says the opposite · never runs'}
      </Typography>
    );
  }
  return fileLabel ? <Typography sx={{ fontSize: 10, color: 'text.muted' }}>from {fileLabel}</Typography> : null;
}

/**
 * A condition drawn as its own pill: "only if <class>" / "skip if <class>",
 * with a dashed link to every block it gates. Drag from its right edge onto
 * a block's left edge to gate that block too.
 */
export function GateNode({ data, selected }: NodeProps<GateFlowNode>) {
  const { gate, source, fileRelation, onHighlight, onModeChange, onRemove } = data;
  const theme = useTheme();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const { mode, className } = gate.condition;
  const blocks = gate.instanceIds.length;
  const compact = useStore(state => state.transform[2] < COMPACT_ZOOM);

  return (
    <Box
      onMouseEnter={() => source?.instanceId && onHighlight(source.instanceId)}
      onMouseLeave={() => onHighlight(null)}
      sx={{
        width: GATE_WIDTH,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        pl: 1.25,
        pr: 0.5,
        py: 0.75,
        bgcolor: 'background.default',
        border: '1px dashed',
        borderColor: selected ? 'primary.main' : fileRelation === 'contradicts' ? 'warning.main' : 'text.muted',
        opacity: fileRelation === 'same' ? 0.6 : 1,
        borderWidth: selected ? 2 : 1,
        borderRadius: '18px',
        cursor: 'grab',
        textAlign: 'left'
      }}
    >
      <FilterAltOutlinedIcon sx={{ fontSize: compact ? 30 : 18, color: 'text.muted', flexShrink: 0 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: compact ? 18 : 11, color: 'text.muted', lineHeight: 1.2 }}>{mode === 'if' ? 'only if' : 'skip if'}</Typography>
        <Typography
          title={className}
          sx={{
            fontSize: compact ? 20 : 12,
            fontFamily: 'monospace',
            fontWeight: 700,
            color: className ? 'text.primary' : 'warning.main',
            // Zoomed out the name wraps rather than truncates — it's the point of the pill.
            ...(compact ? { overflowWrap: 'anywhere' } : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })
          }}
        >
          {className || 'class not chosen yet'}
        </Typography>
        {!compact && <GateCaption fileRelation={fileRelation} fileLabel={source?.fileLabel} />}
      </Box>
      <IconButton className="nodrag nopan" size="small" title="Change or remove" onClick={event => setMenuAnchor(event.currentTarget)} sx={{ p: 0.25 }}>
        <MoreHorizIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <Handle
        id="gate-out"
        type="source"
        position={Position.Right}
        title="Drag onto another block's left edge to gate it too"
        style={{ width: 10, height: 10, background: theme.palette.text.secondary, border: `2px solid ${theme.palette.background.default}` }}
      />
      <Menu {...stopCanvasEvents} anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          selected={mode === 'if'}
          onClick={() => {
            onModeChange('if');
            setMenuAnchor(null);
          }}
        >
          <ListItemText primary="Only if" secondary="Blocks run only while this class is set." slotProps={{ secondary: { sx: { fontSize: 11 } } }} />
        </MenuItem>
        <MenuItem
          selected={mode === 'unless'}
          onClick={() => {
            onModeChange('unless');
            setMenuAnchor(null);
          }}
        >
          <ListItemText primary="Skip if" secondary="Blocks are skipped while this class is set." slotProps={{ secondary: { sx: { fontSize: 11 } } }} />
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            onRemove();
            setMenuAnchor(null);
          }}
        >
          <ListItemText primary={blocks > 1 ? `Remove from all ${blocks} blocks` : 'Remove condition'} />
        </MenuItem>
      </Menu>
    </Box>
  );
}
