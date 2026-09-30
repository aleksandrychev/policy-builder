import { useState } from 'react';

import { Box, useTheme } from '@mui/material';

import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, type InternalNode, Position, getBezierPath, useInternalNode } from '@xyflow/react';

import { describeOutcomes } from '../canvas/outcomes';
import type { BlockOutcome } from '../store/edgesSlice/types';
import { OutcomeMenu } from './OutcomeMenu';

export interface OutcomeEdgeData extends Record<string, unknown> {
  onDelete: () => void;
  onOutcomesChange: (outcomes: BlockOutcome[]) => void;
  outcomes: BlockOutcome[];
}

export type OutcomeFlowEdge = Edge<OutcomeEdgeData, 'outcome'>;

interface Endpoints {
  sourcePosition: Position;
  sourceX: number;
  sourceY: number;
  targetPosition: Position;
  targetX: number;
  targetY: number;
}

function rectOf(node: InternalNode | undefined) {
  const width = node?.measured.width;
  const height = node?.measured.height;
  if (!node || !width || !height) return undefined;
  return { ...node.internals.positionAbsolute, width, height };
}

// Which sides an arrow attaches to, from where the two blocks actually sit
// (React Flow's "floating edges" idea): bottom → top when the target is
// below — the ports' own positions, so a stacked column looks unchanged —
// top → bottom when it's above, and side → side when the blocks sit next to
// each other (their vertical extents overlap), instead of always looping
// out of the bottom dot and back into the top one.
function floatingEndpoints(source: ReturnType<typeof rectOf>, target: ReturnType<typeof rectOf>): Endpoints | undefined {
  if (!source || !target) return undefined;
  const sideBySide = source.y < target.y + target.height && target.y < source.y + source.height;
  if (sideBySide) {
    const toRight = target.x + target.width / 2 >= source.x + source.width / 2;
    return {
      sourceX: toRight ? source.x + source.width : source.x,
      sourceY: source.y + source.height / 2,
      sourcePosition: toRight ? Position.Right : Position.Left,
      targetX: toRight ? target.x : target.x + target.width,
      targetY: target.y + target.height / 2,
      targetPosition: toRight ? Position.Left : Position.Right
    };
  }
  const below = target.y >= source.y + source.height;
  return {
    sourceX: source.x + source.width / 2,
    sourceY: below ? source.y + source.height : source.y,
    sourcePosition: below ? Position.Bottom : Position.Top,
    targetX: target.x + target.width / 2,
    targetY: below ? target.y : target.y + target.height,
    targetPosition: below ? Position.Top : Position.Bottom
  };
}

// Outcome-coloured curve with a label chip in the middle; the chip is where
// the outcomes are chosen (every arrow leaves the block's single output port).
export function OutcomeEdge(props: EdgeProps<OutcomeFlowEdge>) {
  const { id, source, target, data, selected, markerEnd } = props;
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  // Until both blocks are measured, fall back to React Flow's handle positions.
  const endpoints = floatingEndpoints(rectOf(sourceNode), rectOf(targetNode)) ?? props;
  const [path, labelX, labelY] = getBezierPath(endpoints);
  if (!data) return null;
  const port = describeOutcomes(data.outcomes);
  const color = theme.palette[port.color].main;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ stroke: color, strokeWidth: selected ? 3 : 2 }} />
      <EdgeLabelRenderer>
        <Box
          className="nodrag nopan"
          onClick={event => setAnchorEl(event.currentTarget)}
          title="Change or remove this arrow"
          sx={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
            cursor: 'pointer',
            px: 1,
            py: 0.25,
            borderRadius: '10px',
            border: `${selected ? 2 : 1}px solid ${color}`,
            bgcolor: 'background.default',
            color,
            fontSize: 11,
            fontWeight: 700,
            whiteSpace: 'nowrap'
          }}
        >
          {port.symbol} {port.label}
        </Box>
      </EdgeLabelRenderer>
      <OutcomeMenu anchorEl={anchorEl} onClose={() => setAnchorEl(null)} outcomes={data.outcomes} onChange={data.onOutcomesChange} onRemove={data.onDelete} />
    </>
  );
}
