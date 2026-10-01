import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { Box, Button, IconButton, Tab, Tabs, Typography } from '@mui/material';

import type { ProjectType } from '../store/projectSlice/types';
import { BlockNodesIcon } from './icons/BlockNodesIcon';

export const PROJECT_TABS = ['Canvas', 'Generated Policy (.cf)', 'Test Results & Logs'] as const;

interface TopBarProps {
  activeTab: number;
  blockCount: number;
  // The open file's entry bundle.
  bundle: string;
  // Unsaved changes since the last save.
  dirty: boolean;
  // "runs only if linux", when the open file is gated.
  fileGate?: string;
  masterfiles: string | null;
  onOpenSettings: () => void;
  onTabChange: (index: number) => void;
  projectName: string;
  type: ProjectType;
}

const chipSx = {
  fontSize: 11,
  fontFamily: 'monospace',
  color: 'text.muted',
  bgcolor: 'background.default',
  px: 0.75,
  py: 0.25,
  borderRadius: '4px',
  border: '1px solid',
  borderColor: 'divider',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 200
} as const;

export function TopBar({ projectName, dirty, masterfiles, bundle, fileGate, blockCount, activeTab, onTabChange, onOpenSettings, type }: TopBarProps) {
  return (
    <Box
      component="header"
      sx={{
        height: 56,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        flexShrink: 0
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <BlockNodesIcon size={18} color="primary.main" />
          <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary', whiteSpace: 'nowrap' }}>
            {projectName}
            {dirty && (
              <Box component="span" title="Unsaved changes" aria-label="Unsaved changes" sx={{ color: 'text.muted', ml: 0.75 }}>
                •
              </Box>
            )}
          </Typography>
          <IconButton size="small" onClick={onOpenSettings} aria-label="Project settings" title="Project settings (⌘,)" sx={{ ml: -1 }}>
            <SettingsOutlinedIcon fontSize="small" />
          </IconButton>
          {type === 'module' && (
            <Typography title="Stored as a cfbs module: other policy sets add it with cfbs add" sx={chipSx}>
              module
            </Typography>
          )}
          {masterfiles && <Typography sx={chipSx}>masterfiles {masterfiles}</Typography>}
          <Typography sx={chipSx}>bundle: {bundle}</Typography>
          {fileGate && (
            <Typography title="The whole file is gated by this condition" sx={chipSx}>
              {fileGate}
            </Typography>
          )}
        </Box>

        <Tabs value={activeTab} onChange={(_event, value: number) => onTabChange(value)} sx={{ minHeight: 'auto', height: '100%' }}>
          {PROJECT_TABS.map(tab => (
            <Tab key={tab} label={tab} sx={{ minHeight: 'auto', fontSize: 14, textTransform: 'none' }} />
          ))}
        </Tabs>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, whiteSpace: 'nowrap' }}>
        <Typography sx={{ fontSize: 12, color: 'text.muted' }}>{blockCount} blocks</Typography>
        <Button variant="contained" color="primary" disabled={blockCount === 0} sx={{ whiteSpace: 'nowrap' }}>
          Generate Policy
        </Button>
      </Box>
    </Box>
  );
}
