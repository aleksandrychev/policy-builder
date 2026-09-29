import { useDeferredValue, useMemo, useState } from 'react';

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';

import type { DecoratorValueType } from '../../blocks/decorators';
import type { DecoratorValue } from '../../blocks/evaluateDecorator';
import { runDecoratorChain } from '../../blocks/runDecoratorChain';
import type { DecoratorInstance } from '../../store/canvasSlice/types';

interface TestTransformsDialogProps {
  // What the value source itself produces before any transform runs (e.g.
  // Define Variable's "File lines" source is slist) — determines whether
  // "Sample input" seeds the chain as one string or a list of lines, same
  // distinction ParameterField's chain-building already makes via
  // currentChainType's own baseType parameter.
  baseType: DecoratorValueType;
  decoratorChain: DecoratorInstance[];
  onClose: () => void;
  open: boolean;
}

function OutputValue({ value }: { value: DecoratorValue }) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <Typography sx={{ fontSize: 12, color: 'text.muted', fontStyle: 'italic' }}>(empty list)</Typography>;
    }
    return (
      <Stack sx={{ gap: 0.25 }}>
        <Typography sx={{ fontSize: 11, color: 'text.muted' }}>{value.length} items</Typography>
        {value.map((item, index) => (
          <Typography key={index} sx={{ fontSize: 13, fontFamily: 'monospace', color: 'text.primary', wordBreak: 'break-word' }}>
            {index}:{' '}
            {item || (
              <Box component="span" sx={{ color: 'text.muted' }}>
                (empty)
              </Box>
            )}
          </Typography>
        ))}
      </Stack>
    );
  }

  return (
    <Typography sx={{ fontSize: 13, fontFamily: 'monospace', color: 'text.primary', wordBreak: 'break-word' }}>
      {value || (
        <Box component="span" sx={{ color: 'text.muted' }}>
          (empty)
        </Box>
      )}
    </Typography>
  );
}

export function TestTransformsDialog({ open, baseType, decoratorChain, onClose }: TestTransformsDialogProps) {
  const [sampleInput, setSampleInput] = useState('');
  // Deferred so typing stays responsive while a long sample re-evaluates.
  const deferredSample = useDeferredValue(sampleInput);
  const steps = useMemo(() => runDecoratorChain(decoratorChain, deferredSample, baseType), [decoratorChain, deferredSample, baseType]);
  const result = steps.at(-1);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>Preview transform</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography sx={{ fontSize: 11, color: 'text.muted' }}>
            Evaluated in JavaScript as an approximation, not real CFEngine — regex_replace/grep/filter use JS RegExp rather than CFEngine’s PCRE engine, the
            “U”/“x” option flags aren’t emulated, sort()’s IP/MAC methods fall back to lexical sorting, and long samples are truncated.
          </Typography>

          <TextField
            label={baseType === 'slist' ? 'Sample input (one item per line)' : 'Sample input'}
            value={sampleInput}
            onChange={event => setSampleInput(event.target.value)}
            helperText={
              baseType === 'slist'
                ? 'Stand-in for what the value source (File lines, List variable, ...) would produce as a list, before any transforms run. Empty lines are dropped.'
                : 'Stand-in for what the value source (File content, Command output, ...) would produce, before any transforms run.'
            }
            fullWidth
            multiline
            minRows={2}
            maxRows={12}
          />

          {result && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted', mb: 0.5 }}>Result</Typography>
              <Box sx={{ border: '2px solid', borderColor: result.error ? 'error.main' : 'primary.main', borderRadius: '4px', p: 1.25 }}>
                {result.error ? <Typography sx={{ fontSize: 12, color: 'error.main' }}>{result.error}</Typography> : <OutputValue value={result.output} />}
              </Box>
            </Box>
          )}

          {steps.length > 1 && (
            <Box>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted', mb: 0.5 }}>Steps (most recent first)</Typography>
              <Stack spacing={1}>
                {steps
                  .map((step, index) => ({ ...step, stepNumber: index + 1 }))
                  .reverse()
                  .map(step => (
                    <Box key={step.id} sx={{ border: '1px solid', borderColor: step.error ? 'error.main' : 'divider', borderRadius: '4px', p: 1.25 }}>
                      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.muted' }}>
                        {step.stepNumber}. {step.label}
                      </Typography>
                      {step.error ? <Typography sx={{ fontSize: 12, color: 'error.main' }}>{step.error}</Typography> : <OutputValue value={step.output} />}
                    </Box>
                  ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
