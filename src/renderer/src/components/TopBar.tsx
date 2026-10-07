import type { ReactNode } from 'react';

import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import CodeIcon from '@mui/icons-material/Code';
import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import { Box, Button, ButtonBase, IconButton, Typography, alpha, useTheme } from '@mui/material';

import type { ProjectType } from '../store/projectSlice/types';
import { BlockNodesIcon } from './icons/BlockNodesIcon';

export const PROJECT_TABS = ['Canvas', 'Generated Policy (.cf)', 'Test Results & Logs', 'Deployment'] as const;
const TAB_ICONS = [AccountTreeOutlinedIcon, CodeIcon, ScienceOutlinedIcon, RocketLaunchOutlinedIcon];
// Shorter in the switch, so the project's chips keep their room (full names in titles and the status bar).
const TAB_SHORT = ['Canvas', 'Generated Policy', 'Tests & Logs', 'Deployment'];

// The views as one segmented control (as n8n's editor does): the active one is a filled segment.
function ViewSwitch({ active, badges, onChange }: { active: number; badges?: Partial<Record<number, ReactNode>>; onChange: (index: number) => void }) {
  const theme = useTheme();
  return (
    <Box
      role="tablist"
      aria-label="Project views"
      sx={{ display: 'flex', p: 0.5, gap: 0.5, borderRadius: 2, bgcolor: alpha(theme.palette.text.primary, 0.06), border: '1px solid', borderColor: 'divider' }}
    >
      {PROJECT_TABS.map((tab, index) => {
        const Icon = TAB_ICONS[index];
        const selected = index === active;
        return (
          <ButtonBase
            key={tab}
            role="tab"
            aria-selected={selected}
            aria-label={tab}
            title={tab}
            onClick={() => onChange(index)}
            sx={{
              gap: 0.75,
              px: 1.5,
              py: 0.75,
              borderRadius: 1.5,
              fontSize: 13,
              fontWeight: selected ? 700 : 500,
              whiteSpace: 'nowrap',
              color: selected ? 'primary.contrastText' : 'text.primary',
              bgcolor: selected ? 'primary.main' : 'transparent',
              boxShadow: selected ? 1 : 0,
              transition: 'background-color 120ms',
              '&:hover': { bgcolor: selected ? 'primary.main' : alpha(theme.palette.text.primary, 0.08) }
            }}
          >
            <Icon sx={{ fontSize: 17 }} />
            {TAB_SHORT[index]}
            {badges?.[index]}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

interface TopBarProps {
  activeTab: number;
  blockCount: number;
  // Unsaved changes since the last save.
  dirty: boolean;
  // "runs only if linux", when the open file is gated.
  fileGate?: string;
  masterfiles: string | null;
  // The open file's namespace.
  namespace: string;
  onOpenSettings: () => void;
  // Saving writes cfbs.json, the builder's data and the generated policy.
  onSave: () => void;
  onTabChange: (index: number) => void;
  projectName: string;
  // A project that isn't on disk yet (the demo) is saved with Save As.
  savedToDisk: boolean;
  // Shown after a tab's name, by tab index (the test environments' spinner / check).
  tabBadges?: Partial<Record<number, ReactNode>>;
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
  maxWidth: 200,
  flexShrink: 0,
  // No room beside the view switch on a narrow window: hidden rather than squeezed (the status bar names the namespace).
  '@media (max-width: 1600px)': { display: 'none' }
} as const;

export function TopBar({
  projectName,
  dirty,
  masterfiles,
  namespace,
  fileGate,
  blockCount,
  activeTab,
  onTabChange,
  onOpenSettings,
  onSave,
  savedToDisk,
  tabBadges,
  type
}: TopBarProps) {
  return (
    <Box
      component="header"
      sx={{
        height: 56,
        display: 'grid',
        // Project on the left, the views centered, Save on the right.
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: 2,
        px: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        flexShrink: 0
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, height: '100%', minWidth: 0, overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
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
            <Typography
              title="Stored as a cfbs module: other policy sets add it with cfbs add"
              sx={{ ...chipSx, '@media (max-width: 1600px)': { display: 'block' } }}
            >
              module
            </Typography>
          )}
          {masterfiles && <Typography sx={chipSx}>masterfiles {masterfiles}</Typography>}
          <Typography sx={chipSx}>namespace: {namespace}</Typography>
          {fileGate && (
            <Typography title="The whole file is gated by this condition" sx={chipSx}>
              {fileGate}
            </Typography>
          )}
        </Box>
      </Box>

      <ViewSwitch active={activeTab} badges={tabBadges} onChange={onTabChange} />

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2, whiteSpace: 'nowrap' }}>
        <Typography sx={{ fontSize: 12, color: 'text.muted' }}>{blockCount} blocks</Typography>
        <Button
          variant="contained"
          color="primary"
          onClick={onSave}
          disabled={savedToDisk && !dirty}
          title={savedToDisk ? 'Save the project and generate its policy (⌘S)' : 'Save the project to disk (⌘S)'}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {savedToDisk ? 'Save' : 'Save As…'}
        </Button>
      </Box>
    </Box>
  );
}
