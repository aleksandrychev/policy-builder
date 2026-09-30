import CloseIcon from '@mui/icons-material/Close';
import { IconButton, useTheme } from '@mui/material';

import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';

export interface GateEdgeData extends Record<string, unknown> {
  onRemove: () => void;
}

export type GateFlowEdge = Edge<GateEdgeData, 'gate'>;

// The dashed, neutral link from a condition gate to a block it gates —
// deliberately unlike the solid, coloured outcome arrows. Selecting it shows
// a remove button (Delete works too).
export function GateEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<GateFlowEdge>) {
  const theme = useTheme();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: selected ? theme.palette.primary.main : theme.palette.text.secondary, strokeWidth: selected ? 2 : 1.5, strokeDasharray: '6 4' }}
      />
      {selected && data && (
        <EdgeLabelRenderer>
          <IconButton
            className="nodrag nopan"
            size="small"
            title="Remove this condition from the block"
            onClick={event => {
              // Or the edge's own click would select the link just removed.
              event.stopPropagation();
              data.onRemove();
            }}
            sx={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
              p: 0.25,
              bgcolor: 'background.default',
              border: '1px solid',
              borderColor: 'divider',
              '&:hover': { bgcolor: 'action.hover' }
            }}
          >
            <CloseIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
