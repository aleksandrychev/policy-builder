import { type ReactNode, useMemo, useState } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import DataObjectIcon from '@mui/icons-material/DataObject';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import TransformIcon from '@mui/icons-material/Transform';
import { Box, IconButton, ListItemText, Menu, MenuItem, TextField, Typography, useTheme } from '@mui/material';

import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';

import { currentChainType, decoratorsById } from '../blocks/decorators';
import type { DecoratorValue } from '../blocks/evaluateDecorator';
import { runDecoratorChain } from '../blocks/runDecoratorChain';
import { DATA_NODE_WIDTH, type DataChain } from '../canvas/dataChains';
import { AddDecoratorButton } from './PropertiesPanel';
import { stopCanvasEvents } from './stopCanvasEvents';

export interface DataNodeData extends Record<string, unknown> {
  chain: DataChain;
  onAddStep: (decoratorId: string) => void;
  onMoveStep: (fromIndex: number, toIndex: number) => void;
  onRemove: () => void;
  onRemoveStep: (stepId: string) => void;
  onSampleChange: (value: string) => void;
}

export type DataFlowNode = Node<DataNodeData, 'data'>;

function formatValue(value: DecoratorValue): string {
  if (!Array.isArray(value)) return value === '' ? '(empty)' : `"${value}"`;
  if (value.length === 0) return 'empty list';
  return `list of ${value.length}: ${value.slice(0, 3).join(', ')}${value.length > 3 ? ', …' : ''}`;
}

const oneLine = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

function StepMenu({ index, count, onMove, onRemove }: { count: number; index: number; onMove: (to: number) => void; onRemove: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = (action: () => void) => () => {
    action();
    setAnchor(null);
  };
  return (
    <>
      <IconButton className="nodrag nopan" size="small" title="Move or remove this step" onClick={event => setAnchor(event.currentTarget)} sx={{ p: 0 }}>
        <MoreHorizIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Menu {...stopCanvasEvents} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        <MenuItem disabled={index === 0} onClick={close(() => onMove(index - 1))}>
          <ListItemText primary="Move up" />
        </MenuItem>
        <MenuItem disabled={index === count - 1} onClick={close(() => onMove(index + 1))}>
          <ListItemText primary="Move down" />
        </MenuItem>
        <MenuItem onClick={close(onRemove)}>
          <ListItemText primary="Remove step" />
        </MenuItem>
      </Menu>
    </>
  );
}

function StepRow({
  title,
  badge,
  params,
  preview,
  isError,
  menu,
  number
}: {
  badge?: string;
  isError?: boolean;
  menu?: ReactNode;
  number?: number;
  params: string;
  preview?: string;
  title: string;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 0.75, py: 0.5, borderTop: 1, borderColor: 'divider' }}>
      <Box sx={{ width: 16, flexShrink: 0, pt: 0.25, fontSize: 10, fontFamily: 'monospace', color: 'text.muted', textAlign: 'center' }}>
        {number ?? <DataObjectIcon sx={{ fontSize: 14, color: 'info.main' }} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography title={title} sx={{ flex: 1, fontSize: 12, fontWeight: 700, lineHeight: 1.4, ...oneLine }}>
            {title}
          </Typography>
          {badge && <Typography sx={{ fontSize: 10, color: 'text.muted', fontFamily: 'monospace', flexShrink: 0 }}>{badge}</Typography>}
          {menu}
        </Box>
        {params && (
          <Typography title={params} sx={{ fontSize: 11, fontFamily: 'monospace', ...oneLine }}>
            {params}
          </Typography>
        )}
        {preview && (
          <Typography title={preview} sx={{ fontSize: 11, fontFamily: 'monospace', color: isError ? 'error.main' : 'info.main', ...oneLine }}>
            {preview}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/**
 * A data chain as one node: its value source, then each transformation step
 * with a one-line preview of its result on the sample input (the Preview
 * dialog's JS approximation, not real CFEngine). Full text is in tooltips.
 */
export function DataNode({ data, selected }: NodeProps<DataFlowNode>) {
  const { chain, onAddStep, onMoveStep, onRemove, onRemoveStep, onSampleChange } = data;
  const theme = useTheme();
  const hasSample = chain.sampleInput.trim() !== '' && chain.baseType !== undefined;
  const results = useMemo(
    () => (hasSample && chain.baseType ? runDecoratorChain(chain.steps, chain.sampleInput, chain.baseType) : []),
    [hasSample, chain.steps, chain.sampleInput, chain.baseType]
  );
  // A source's own parameters only: the shared entry name isn't among them.
  const sourceParams = chain.source.parameters
    .filter(parameter => chain.sourceParams[parameter.name])
    .slice(0, 2)
    .map(parameter => chain.sourceParams[parameter.name])
    .join(' · ');
  const handleStyle = { width: 8, height: 8, background: theme.palette.info.main, border: `2px solid ${theme.palette.background.default}` };

  return (
    <Box
      sx={{
        width: DATA_NODE_WIDTH,
        bgcolor: 'background.default',
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'info.main',
        borderWidth: selected ? 2 : 1,
        borderRadius: '6px',
        boxShadow: 2,
        textAlign: 'left',
        cursor: 'grab',
        '&:hover .data-node-remove': { opacity: 1 }
      }}
    >
      <Box
        title={`Computes the value of ${chain.targetKind} ${chain.targetLabel}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.75,
          bgcolor: 'background.summary',
          borderBottom: 1,
          borderColor: 'divider',
          borderTopLeftRadius: '5px',
          borderTopRightRadius: '5px'
        }}
      >
        <TransformIcon sx={{ fontSize: 16, color: 'info.main', flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>Data transformer</Typography>
          <Typography sx={{ fontSize: 11, color: 'text.muted', lineHeight: 1.3, ...oneLine }}>
            for {chain.targetKind}{' '}
            <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 700, color: 'info.main' }}>
              {chain.targetLabel}
            </Box>
          </Typography>
        </Box>
        <IconButton
          className="data-node-remove nodrag nopan"
          size="small"
          title="Remove this transformer (the variable stays)"
          onClick={event => {
            event.stopPropagation();
            onRemove();
          }}
          sx={{ opacity: 0, transition: 'opacity 0.15s', p: 0.25 }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Box>
      <Box sx={{ px: 1, pb: 0.5, '& > :first-of-type': { borderTop: 0 } }}>
        <StepRow title={chain.source.label} badge={chain.source.badge} params={sourceParams} />
        {chain.baseType && (
          <TextField
            className="nodrag nopan"
            size="small"
            multiline
            maxRows={2}
            value={chain.sampleInput}
            onChange={event => onSampleChange(event.target.value)}
            placeholder="Sample input, to preview the steps…"
            sx={{ mb: 0.5, ml: 2.75, width: 'calc(100% - 22px)', '& .MuiInputBase-root': { py: 0.5, px: 0.75 } }}
            slotProps={{ htmlInput: { style: { fontSize: 10, fontFamily: 'monospace', lineHeight: 1.3 } } }}
          />
        )}
        {chain.steps.map((step, index) => {
          const decorator = decoratorsById.get(step.decoratorId);
          const result = results[index];
          const params = (decorator?.parameters ?? [])
            .filter(parameter => step.params[parameter.name])
            .map(parameter => step.params[parameter.name])
            .join(' · ');
          return (
            <StepRow
              key={step.id}
              number={index + 1}
              title={decorator?.label ?? step.decoratorId}
              badge={decorator?.badge}
              params={params}
              preview={result?.error ?? (result ? `→ ${formatValue(result.output)}` : undefined)}
              isError={Boolean(result?.error)}
              menu={<StepMenu index={index} count={chain.steps.length} onMove={to => onMoveStep(index, to)} onRemove={() => onRemoveStep(step.id)} />}
            />
          );
        })}
        {chain.baseType && (
          <Box
            className="nodrag nopan"
            {...stopCanvasEvents}
            sx={{
              borderTop: 1,
              borderColor: 'divider',
              pt: 0.25,
              '& .MuiButton-root': { fontSize: 11, py: 0, minHeight: 0 },
              '& .MuiButton-startIcon svg': { fontSize: 14 }
            }}
          >
            <AddDecoratorButton chainType={currentChainType(chain.steps, chain.baseType)} onAdd={onAddStep} />
          </Box>
        )}
      </Box>
      <Handle id="data-out" type="source" position={Position.Right} isConnectable={false} style={{ ...handleStyle, top: 24 }} />
    </Box>
  );
}
