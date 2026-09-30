import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Box, Typography, alpha, useTheme } from '@mui/material';

import { type Node, type NodeProps, NodeResizer, useStore } from '@xyflow/react';

import { GROUP_TITLE_HEIGHT } from '../canvas/groupFrames';
import type { BlockGroup } from '../store/groupsSlice/types';

export interface GroupFrameNodeData extends Record<string, unknown> {
  dropTarget: boolean;
  group: BlockGroup;
  isSelected: boolean;
  memberCount: number;
  onResize: (rect: { height: number; width: number; x: number; y: number }) => void;
  onResizeEnd: () => void;
  onResizeStart: () => void;
  // Order numbers of outside blocks that run in between the group's members.
  outsiders: number[];
}

export type GroupFrameFlowNode = Node<GroupFrameNodeData, 'groupFrame'>;

/**
 * A group's frame. Only the title bar takes the pointer — grab it to move the
 * whole group, click it to edit the group — so the body stays click-through
 * to the canvas and the blocks inside.
 */
export function GroupFrameNode({ data }: NodeProps<GroupFrameFlowNode>) {
  const { group, isSelected: selected, memberCount, outsiders, dropTarget, onResize, onResizeStart, onResizeEnd } = data;
  const theme = useTheme();
  const color = theme.palette[group.color].main;
  // Same threshold as block cards: zoomed out, the title grows so it stays readable.
  const compact = useStore(state => state.transform[2] < 0.55);

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
        {outsiders.length > 0 && (
          <Box
            title={`Block${outsiders.length > 1 ? 's' : ''} ${outsiders.map(order => `#${order}`).join(', ')} from outside this group run${outsiders.length > 1 ? '' : 's'} in between its blocks. A group is only visual: order still follows arrows and position.`}
            sx={{ display: 'flex', color: 'warning.main', ml: 'auto' }}
          >
            <WarningAmberIcon sx={{ fontSize: 16 }} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
