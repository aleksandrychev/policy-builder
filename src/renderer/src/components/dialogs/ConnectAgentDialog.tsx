import { useEffect, useState } from 'react';

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography
} from '@mui/material';

import type { McpPermissions, McpStatus } from '../../../../preload/api';
import { AGENTS, agentById } from '../../mcp/agents';

// What agents may do, in the order shown; reading the project is always on, deleting comes last.
const PERMISSIONS: { help: string; key: keyof McpPermissions; label: string }[] = [
  { key: 'edit', label: 'Edit blocks and variables', help: 'Blocks, arrows, groups, entries, transformers and conditions' },
  { key: 'files', label: 'Files and folders', help: 'Add, rename and describe policy files and folders' },
  { key: 'projects', label: 'Create, open and save projects', help: 'Writes the project to disk' },
  { key: 'testing', label: 'Run tests', help: 'Set up test environments and run them in Docker' }
];

// Turning a permission on or off, as a row: what it allows, and its switch.
function PermissionRow({
  checked,
  disabled,
  help,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  help: string;
  label: string;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <ListItem
      secondaryAction={
        <Switch
          edge="end"
          size="small"
          checked={checked}
          disabled={disabled}
          onChange={event => onChange?.(event.target.checked)}
          slotProps={{ input: { 'aria-label': label } }}
        />
      }
    >
      <ListItemText primary={label} secondary={help} slotProps={{ primary: { sx: { fontSize: 13 } }, secondary: { sx: { fontSize: 12 } } }} />
    </ListItem>
  );
}

// The agent picked last time.
const AGENT_KEY = 'cfpb.connectAgent';

/**
 * Connect an AI agent: turns on the local MCP server it drives the open project
 * through, and shows how to add it to the agent the user picks.
 */
export function ConnectAgentDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [agent, setAgent] = useState(() => agentById(localStorage.getItem(AGENT_KEY)));

  useEffect(() => {
    void window.api?.mcpStatus().then(setStatus);
  }, []);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      setStatus((await window.api?.mcpSetEnabled(enabled)) ?? null);
    } finally {
      setBusy(false);
    }
  };
  const setPermission = async (key: keyof McpPermissions, allowed: boolean) => {
    if (!status) return;
    setStatus((await window.api?.mcpSetPermissions({ ...status.permissions, [key]: allowed })) ?? status);
  };
  const pick = (id: string) => {
    localStorage.setItem(AGENT_KEY, id);
    setAgent(agentById(id));
  };
  const snippet = status?.enabled && status.url && status.token ? agent.snippet({ name: status.name, token: status.token, url: status.url }) : null;
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Connect an AI agent</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography sx={{ fontSize: 14 }}>
            An AI agent such as Claude Code can read and change the open project through Policy Builder’s own tools: blocks, arrows, variables, conditions and
            test environments, shown on the canvas as it works, each change one undo step. It uses the agent’s own sign-in.
          </Typography>
          <FormControlLabel
            control={<Switch checked={status?.enabled ?? false} disabled={!status || busy} onChange={event => void toggle(event.target.checked)} />}
            label="Let AI agents connect"
          />
          {status?.error && <Alert severity="error">Couldn’t start the connection: {status.error}</Alert>}
          {snippet && (
            <Stack spacing={1.5}>
              <FormControl size="small" sx={{ maxWidth: 280 }}>
                <InputLabel id="connect-agent-label">Agent</InputLabel>
                <Select labelId="connect-agent-label" label="Agent" value={agent.id} onChange={event => pick(event.target.value)}>
                  {AGENTS.map(item => (
                    <MenuItem key={item.id} value={item.id}>
                      {item.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography sx={{ fontSize: 13 }}>{agent.how}</Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  fontSize: 12,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  bgcolor: 'background.default',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1
                }}
              >
                {snippet}
              </Box>
              <Box>
                <Button size="small" variant="outlined" onClick={() => copy(snippet)}>
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </Box>
              <Typography sx={{ fontSize: 12, color: 'text.muted' }}>
                Only programs on this computer that know the token can connect. Keep Policy Builder open with the project; nothing is saved until you (or the
                agent) save.
              </Typography>
            </Stack>
          )}
        </Stack>
        {status && (
          <Box sx={{ mt: 3 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600 }}>What agents may do</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.muted', mb: 1 }}>Applies to every agent at once. What’s off isn’t offered to them.</Typography>
            <List dense disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <PermissionRow label="Read the project" help="Always on: files, blocks, generated policy, variables, test results" checked disabled />
              {PERMISSIONS.map(({ help, key, label }) => (
                <PermissionRow key={key} label={label} help={help} checked={status.permissions[key]} onChange={allowed => void setPermission(key, allowed)} />
              ))}
              <Divider component="li" />
              <PermissionRow
                label="Allow deleting"
                help="Remove blocks, arrows, entries, transformer steps, files and test environments"
                checked={status.permissions.delete}
                onChange={allowed => void setPermission('delete', allowed)}
              />
            </List>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
