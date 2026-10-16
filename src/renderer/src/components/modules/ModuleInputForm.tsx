import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { Box, Button, IconButton, TextField, Typography } from '@mui/material';

import type { ModuleInputField, ModuleInputQuestion } from '../../modules/catalog';
import { isSupported, newEntry } from '../../modules/moduleInput';
import type { ModuleInputResponse } from '../../store/modulesSlice';

interface ModuleInputFormProps {
  answers: Record<string, ModuleInputResponse>;
  onChange: (variable: string, response: ModuleInputResponse) => void;
  questions: ModuleInputQuestion[];
}

const fieldLabel = (field: ModuleInputField) => field.label ?? field.key ?? '';

function TextQuestion({ onChange, question, value }: { onChange: (value: string) => void; question: ModuleInputQuestion; value: string }) {
  return (
    <TextField
      label={question.label ?? question.variable}
      placeholder={question.question}
      helperText={question.default ? `Default: ${question.default}` : undefined}
      value={value}
      onChange={event => onChange(event.target.value)}
      variant="standard"
      size="small"
      fullWidth
    />
  );
}

function ListQuestion({
  onChange,
  question,
  value
}: {
  onChange: (value: ModuleInputResponse) => void;
  question: ModuleInputQuestion;
  value: ModuleInputResponse | undefined;
}) {
  const fields = Array.isArray(question.subtype) ? question.subtype : null;
  const entries: (Record<string, string> | string)[] = Array.isArray(value) ? value : [];
  const update = (index: number, entry: Record<string, string> | string) =>
    onChange(entries.map((current, at) => (at === index ? entry : current)) as ModuleInputResponse);
  const single = !Array.isArray(question.subtype) ? question.subtype : undefined;
  return (
    <Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, color: 'text.primary' }}>{question.label ?? question.variable}</Typography>
      {question.question && <Typography sx={{ fontSize: 12, color: 'text.muted' }}>{question.question}</Typography>}
      {entries.length === 0 && <Typography sx={{ fontSize: 12, color: 'text.muted', mt: 0.75 }}>(Not set)</Typography>}
      {entries.map((entry, index) => (
        <Box key={index} sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, mt: 1, p: 1, pr: 0.5, bgcolor: 'background.default', borderRadius: '4px' }}>
          {fields ? (
            fields.map(field => (
              <TextField
                key={field.key}
                label={fieldLabel(field)}
                placeholder={field.question}
                value={typeof entry === 'string' ? '' : (entry[field.key ?? ''] ?? '')}
                onChange={event => update(index, { ...(typeof entry === 'string' ? {} : entry), [field.key ?? '']: event.target.value })}
                variant="standard"
                size="small"
                sx={{ flex: 1 }}
              />
            ))
          ) : (
            <TextField
              label={single?.label}
              placeholder={single?.question}
              value={typeof entry === 'string' ? entry : ''}
              onChange={event => update(index, event.target.value)}
              variant="standard"
              size="small"
              sx={{ flex: 1 }}
            />
          )}
          <IconButton size="small" aria-label="Remove" onClick={() => onChange(entries.filter((_entry, at) => at !== index) as ModuleInputResponse)}>
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...entries, newEntry(question)] as ModuleInputResponse)} sx={{ mt: 0.75, px: 0.5 }}>
        Add
      </Button>
    </Box>
  );
}

/** A module's input questions as a form, as Mission Portal's Build app shows them: texts, and lists of rows. */
export function ModuleInputForm({ answers, onChange, questions }: ModuleInputFormProps) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {questions.map((question, index) => {
        const variable = question.variable;
        if (!variable || !isSupported(question))
          return (
            <Typography key={variable ?? index} sx={{ fontSize: 13, color: 'text.muted' }}>
              {question.label ?? variable}: this input type isn’t supported in the builder yet; answer it with cfbs input.
            </Typography>
          );
        return question.type === 'string' ? (
          <TextQuestion
            key={variable}
            question={question}
            value={typeof answers[variable] === 'string' ? answers[variable] : ''}
            onChange={value => onChange(variable, value)}
          />
        ) : (
          <ListQuestion key={variable} question={question} value={answers[variable]} onChange={value => onChange(variable, value)} />
        );
      })}
    </Box>
  );
}
