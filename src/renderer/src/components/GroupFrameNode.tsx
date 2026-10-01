import { Box, Typography, alpha, useTheme } from '@mui/material';

import { Handle, type Node, type NodeProps, NodeResizer, Position, useStore } from '@xyflow/react';

import { GROUP_TITLE_HEIGHT } from '../canvas/groupFrames';
import type { BlockGroup } from '../store/groupsSlice/types';

export interface GroupFrameNodeData extends Record<string, unknown> {
  // Has a block that runs, so arrows can go in and out of the group.
  connectable: boolean;
  dropTarget: boolean;
  group: BlockGroup;
  isSelected: boolean;
  memberCount: number;
  onResize: (rect: { height: number; width: number; x: number; y: number }) => void;
  onResizeEnd: () => void;
  onResizeStart: () => void;
}

export type GroupFrameFlowNode = Node<GroupFrameNodeData, 'groupFrame'>;

/**
 * A group's frame. Only the title bar takes the pointer — grab it to move the
 * whole group, click it to edit the group — so the body stays click-through
 * to the canvas and the blocks inside. Its top and bottom dots take arrows
 * like a block's: the group runs as one step.
 */
export function GroupFrameNode({ data }: NodeProps<GroupFrameFlowNode>) {
  const { group, isSelected: selected, memberCount, connectable, dropTarget, onResize, onResizeStart, onResizeEnd } = data;
  const theme = useTheme();
  const color = theme.palette[group.color].main;
  // Same threshold as block cards: zoomed out, the title grows so it stays readable.
  const compact = useStore(state => state.transform[2] < 0.55);
  const handleSx = { width: 14, height: 14, border: `2px solid ${theme.palette.background.default}`, pointerEvents: 'all' as const };
  const condition = group.condition?.className.trim() ? group.condition : undefined;

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        border: `${selected || dropTarget ? 2 : 1}px ${dropTarget ? 'dashed' : 'solid'} ${color}`,
        borderRadius: '10px',
        bgcolor: alpha(color, dropTarget ? 0.1 : 0.04)
      }}
    >
      {/* Drag an edge or corner to make room; it never shrinks past its blocks. */}
      <NodeResizer
        isVisible={selected}
        color={color}
        minWidth={160}
        minHeight={100}
        lineStyle={{ pointerEvents: 'all', borderWidth: 2 }}
        handleStyle={{ pointerEvents: 'all', width: 10, height: 10, borderRadius: 2 }}
        onResizeStart={onResizeStart}
        onResize={(_event, params) => onResize({ x: params.x, y: params.y, width: params.width, height: params.height })}
        onResizeEnd={onResizeEnd}
      />
      <Box
        className="group-drag-handle"
        title="Drag to move the group · click to edit it"
        sx={{
          pointerEvents: 'all',
          cursor: 'grab',
          minHeight: GROUP_TITLE_HEIGHT,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          borderTopLeftRadius: '9px',
          borderTopRightRadius: '9px',
          bgcolor: alpha(color, 0.12),
          textAlign: 'left'
        }}
      >
        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
        <Typography
          sx={{ fontSize: compact ? 26 : 14, fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {group.name || 'Untitled group'}
        </Typography>
        <Typography sx={{ fontSize: compact ? 20 : 12, color: 'text.muted', whiteSpace: 'nowrap' }}>
          {memberCount} {memberCount === 1 ? 'block' : 'blocks'}
        </Typography>
        {condition && (
          <Typography
            title={`The group runs only ${condition.mode === 'unless' ? 'unless' : 'if'} ${condition.className}`}
            sx={{
              fontSize: compact ? 20 : 12,
              fontFamily: 'monospace',
              color: 'text.secondary',
              ml: 'auto',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {condition.mode === 'unless' ? 'unless' : 'if'} {condition.className}
          </Typography>
        )}
      </Box>
      {connectable && (
        <>
          <Handle id="in" type="target" position={Position.Top} style={{ ...handleSx, background: theme.palette.text.secondary }} />
          <Handle
            id="out"
            type="source"
            position={Position.Bottom}
            title="Drag onto a block or group to run it after this group"
            style={{ ...handleSx, background: color }}
          />
        </>
      )}
    </Box>
  );
}
