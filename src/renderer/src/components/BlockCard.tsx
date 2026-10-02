import { useMemo } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import { Box, IconButton, Typography, useTheme } from '@mui/material';

import { Handle, type Node, type NodeProps, Position, useStore } from '@xyflow/react';

import { PROMISE_TYPE_ICONS } from '../blocks/promiseTypeIcons';
import { primaryPromiseType } from '../blocks/resolveBlockShape';
import type { BlockDescriptor } from '../blocks/types';
import { cardRows } from '../canvas/cardRows';
import { isSequenced } from '../canvas/executionOrder';
import { NODE_WIDTH } from '../canvas/layout';
import type { BlockInstance } from '../store/canvasSlice/types';

// Where the class named in a block's condition comes from, when known: a
// Define Class block on this canvas (highlighted on hover), or another file.
export interface ConditionSource {
  fileLabel?: string;
  instanceId?: string;
}

export interface BlockNodeData extends Record<string, unknown> {
  // Cut to the clipboard, waiting to be pasted.
  cutPending?: boolean;
  descriptor: BlockDescriptor | undefined;
  // `${blockId}:${name}` keys of names defined more than once in this file.
  duplicateKeys: Set<string>;
  // Hosts its promises failed on in the last test run.
  failedOn?: string[];
  // A data chain flows into this block (its variable, or a data-fed parameter).
  hasDataInput?: boolean;
  // Set while a condition gate is hovered whose class this block defines.
  highlighted?: boolean;
  instance: BlockInstance;
  onRemove: () => void;
  // 1-based position in the file's methods: call order; undefined for
  // blocks that aren't sequenced (Define Variable / Define Class).
  orderNumber?: number;
}

export type BlockFlowNode = Node<BlockNodeData, 'block'>;

// Below this zoom the card drops its detail rows for a large title, so the
// canvas stays readable zoomed out.
export const COMPACT_ZOOM = 0.55;

// Multi-entry blocks (Define Variable / Class) can gate single entries; the
// block's own condition is drawn as a gate pill instead (see GateNode).
function EntryConditionsLine({ conditional, total, noun }: { conditional: number; noun?: string; total: number }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, borderRadius: '4px', bgcolor: 'action.hover' }}>
      <FilterAltOutlinedIcon sx={{ fontSize: 14, color: 'text.muted' }} />
      <Typography sx={{ fontSize: 11, color: 'text.primary' }}>
        {conditional} of {total} {noun ?? 'entries'} conditional
      </Typography>
    </Box>
  );
}

// The card's grey title bar; with rows below it, a divider instead of rounded bottom corners.
const headerSx = (hasBody: boolean) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  px: 1.5,
  py: 1.25,
  bgcolor: 'background.summary',
  borderRadius: hasBody ? '5px 5px 0 0' : '5px',
  ...(hasBody ? { borderBottom: '1px solid', borderColor: 'divider' } : {})
});

// "Failed on client1": some of the block's promises weren't kept in the last test run.
function FailedOnBadge({ compact, hosts }: { compact: boolean; hosts?: string[] }) {
  if (!hosts?.length) return null;
  return (
    <Typography
      title="Some of its promises weren’t kept in the last test run — see Test Results & Logs"
      sx={{
        display: 'inline-block',
        mb: 0.5,
        px: 0.75,
        borderRadius: 0.5,
        fontSize: compact ? 20 : 11,
        fontWeight: 700,
        color: 'error.contrastText',
        bgcolor: 'error.main'
      }}
    >
      Failed on {hosts.join(', ')}
    </Typography>
  );
}

export function BlockCard({ data, selected }: NodeProps<BlockFlowNode>) {
  const { instance, descriptor, duplicateKeys, orderNumber, onRemove, highlighted, hasDataInput, failedOn, cutPending = false } = data;
  const theme = useTheme();
  const compact = useStore(state => state.transform[2] < COMPACT_ZOOM);
  const sequenced = isSequenced(descriptor);

  const promiseType = descriptor && primaryPromiseType(descriptor);
  const TypeIcon = promiseType ? PROMISE_TYPE_ICONS[promiseType] : undefined;
  const { rows, hidden } = useMemo(() => cardRows(instance, descriptor, duplicateKeys), [instance, descriptor, duplicateKeys]);
  const entryCount = instance.entries?.length ?? 0;
  const conditionalEntries = (instance.entries ?? []).filter(entry => entry.condition).length;
  const handleSx = { width: 12, height: 12, border: `2px solid ${theme.palette.background.default}` };

  return (
    <Box
      sx={{
        opacity: cutPending ? 0.45 : 1,
        width: NODE_WIDTH,
        bgcolor: 'background.default',
        border: '1px solid',
        // Dashed only while cut, waiting to be pasted.
        borderStyle: cutPending ? 'dashed' : 'solid',
        borderColor: selected ? 'primary.main' : highlighted ? 'info.main' : 'divider',
        borderWidth: selected || highlighted ? 2 : 1,
        boxShadow: highlighted ? `0 0 0 4px ${theme.palette.info.main}33, ${theme.shadows[2]}` : theme.shadows[2],
        borderRadius: '6px',
        cursor: cutPending ? 'default' : 'grab',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'left',
        '&:hover .block-card-remove': { opacity: 1 }
      }}
    >
      {/* Where a data chain's last arrow lands. Always mounted (just hidden) so
          React Flow has measured it by the time a binding is added. */}
      <Handle
        id="data"
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={{
          // Level with the first chain row; the condition pill's link lands mid-height.
          top: 24,
          width: 10,
          height: 10,
          background: theme.palette.info.main,
          border: `2px solid ${theme.palette.background.default}`,
          visibility: hasDataInput ? 'visible' : 'hidden'
        }}
      />
      {/* Where a condition gate's dashed link lands — any block can be gated. */}
      <Handle
        id="gate"
        type="target"
        position={Position.Left}
        title="Drop a condition here"
        style={{ width: 8, height: 8, borderRadius: 2, background: theme.palette.text.secondary, border: `2px solid ${theme.palette.background.default}` }}
      />
      {sequenced && <Handle id="in" type="target" position={Position.Top} style={{ ...handleSx, background: theme.palette.text.secondary }} />}

      <Box sx={headerSx(!compact && rows.length > 0)}>
        {!compact && conditionalEntries > 0 && (
          <EntryConditionsLine conditional={conditionalEntries} total={entryCount} noun={descriptor?.entries?.noun_plural} />
        )}
        <FailedOnBadge hosts={failedOn} compact={compact} />
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box
              sx={{
                width: compact ? 56 : 32,
                height: compact ? 56 : 32,
                borderRadius: '6px',
                bgcolor: 'background.default',
                color: 'text.muted',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              {TypeIcon && <TypeIcon sx={{ fontSize: compact ? 32 : 18 }} />}
            </Box>
            <Typography sx={{ fontSize: compact ? 26 : 14, fontWeight: 700, color: 'text.primary', wordBreak: 'break-word' }}>{instance.label}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
            {compact && conditionalEntries > 0 && (
              <FilterAltOutlinedIcon titleAccess={`${conditionalEntries} conditional`} sx={{ fontSize: 24, color: 'text.muted' }} />
            )}
            {orderNumber !== undefined && (
              <Typography
                title="Position in this file's execution order"
                sx={{ fontSize: compact ? 22 : 11, fontWeight: 700, color: 'primary.main', fontFamily: 'monospace' }}
              >
                #{orderNumber}
              </Typography>
            )}
            {!compact && (
              <Typography sx={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: 'text.muted', letterSpacing: 0.5 }}>
                {(promiseType ?? instance.blockId).toUpperCase()}
              </Typography>
            )}
            <IconButton
              className="block-card-remove nodrag nopan"
              size="small"
              onClick={event => {
                event.stopPropagation();
                onRemove();
              }}
              sx={{ opacity: 0, transition: 'opacity 0.15s', p: 0.25 }}
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        </Box>
      </Box>

      {!compact && rows.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, px: 1.5, py: 1.25 }}>
          {rows.map(row => (
            <Box key={row.key} sx={{ display: 'flex', gap: 0.75 }}>
              <Typography
                sx={{
                  fontSize: 11,
                  flexShrink: 0,
                  color: row.error ? 'error.main' : row.monospaceLabel ? 'text.primary' : 'text.muted',
                  ...(row.monospaceLabel
                    ? { fontFamily: 'monospace', fontWeight: 700, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                    : {})
                }}
              >
                {row.monospaceLabel ? row.label : `${row.label}:`}
              </Typography>
              <Typography
                sx={{
                  fontSize: 11,
                  color: row.error && !row.monospaceLabel ? 'error.main' : row.monospaceLabel ? 'text.muted' : 'text.primary',
                  ...(row.truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } : { wordBreak: 'break-word' })
                }}
              >
                {row.value}
              </Typography>
            </Box>
          ))}
          {hidden > 0 && <Typography sx={{ fontSize: 11, color: 'text.muted' }}>+{hidden} more</Typography>}
        </Box>
      )}

      {/* One output: drag it onto another block to run that one after this;
          what it waits for (repaired by default) is picked on the arrow. */}
      {sequenced && (
        <Handle
          id="out"
          type="source"
          position={Position.Bottom}
          title="Drag onto another block to run it after this one"
          style={{ ...handleSx, width: 14, height: 14, background: theme.palette.primary.main }}
        />
      )}
    </Box>
  );
}
