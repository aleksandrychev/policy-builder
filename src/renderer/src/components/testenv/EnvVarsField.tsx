import { TextField } from '@mui/material';

import { useDraft } from './useDraft';

const format = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

// `KEY=value` lines; anything else is dropped.
export function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    if (at > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = line.slice(at + 1);
  }
  return env;
}

/** Environment variables as `KEY=value` lines, saved when the field loses focus or goes away. */
export function EnvVarsField({
  disabled,
  env,
  label,
  onChange
}: {
  disabled?: boolean;
  env: Record<string, string>;
  label: string;
  onChange: (env: Record<string, string>) => void;
}) {
  const draft = useDraft(format(env), text => onChange(parseEnvVars(text)));
  return (
    <TextField
      label={label}
      size="small"
      multiline
      minRows={2}
      fullWidth
      disabled={disabled}
      placeholder="KEY=value, one per line"
      value={draft.value}
      onChange={event => draft.setDraft(event.target.value)}
      onBlur={draft.flush}
      slotProps={{ htmlInput: { style: { fontFamily: 'monospace', fontSize: 12 } } }}
    />
  );
}
