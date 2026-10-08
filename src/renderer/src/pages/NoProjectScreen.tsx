import { useEffect, useState } from 'react';

import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Box, Button, ButtonBase, Divider, Stack, Tooltip, Typography } from '@mui/material';

import { middleTruncate } from '../components/ProjectStatusLabel';
import { StatusBar } from '../components/StatusBar';
import { BlockNodesIcon } from '../components/icons/BlockNodesIcon';

const RECENT_PATH_CHARS = 60;

type RecentProject = Awaited<ReturnType<NonNullable<Window['api']>['getRecentProjects']>>[number];

interface NoProjectScreenProps {
  onNewProject: () => void;
  onOpenProject: (path?: string) => void;
  onTryDemo: () => void;
  // Changes when the recent-projects list does.
  recentsVersion: number;
}

function RecentProjects({ onOpen, version }: { onOpen: (path: string) => void; version: number }) {
  const [recents, setRecents] = useState<RecentProject[]>([]);
  useEffect(() => {
    let current = true;
    window.api
      ?.getRecentProjects()
      .then(list => current && setRecents(list))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [version]);

  if (!recents.length) return null;
  return (
    <Box sx={{ width: '100%', mb: 3, textAlign: 'left' }}>
      <Typography component="h2" sx={{ fontSize: 12, fontWeight: 700, color: 'text.muted', mb: 1 }}>
        Recent projects
      </Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, border: '1px solid', borderColor: 'divider', borderRadius: '8px', bgcolor: 'background.paper' }}>
        {recents.map(({ exists, name, path }, index) => (
          <Box component="li" key={path} sx={{ display: 'flex', alignItems: 'center', borderTop: index ? '1px solid' : 'none', borderColor: 'divider' }}>
            <ButtonBase
              disabled={!exists}
              onClick={() => onOpen(path)}
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                px: 1.5,
                py: 1,
                textAlign: 'left',
                borderRadius: '8px',
                opacity: exists ? 1 : 0.55,
                '&:hover .recent-name, &.Mui-focusVisible .recent-name': { color: 'primary.main' }
              }}
            >
              <FolderOutlinedIcon sx={{ fontSize: 20, color: 'text.muted', flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography className="recent-name" noWrap sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>
                  {name}
                </Typography>
                <Tooltip title={path} placement="bottom-start" enterDelay={500}>
                  <Typography noWrap sx={{ fontSize: 12, color: 'text.muted' }}>
                    {exists ? middleTruncate(path, RECENT_PATH_CHARS) : `Not found: ${middleTruncate(path, RECENT_PATH_CHARS - 11)}`}
                  </Typography>
                </Tooltip>
              </Box>
            </ButtonBase>
            {!exists && (
              <Button
                size="small"
                variant="text"
                color="primary"
                sx={{ mr: 1, flexShrink: 0 }}
                onClick={() => window.api?.forgetRecentProject(path).catch(() => {})}
              >
                Remove
              </Button>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * First screen the app shows: no project has been created or opened yet.
 * The New Project dialog itself lives in App.tsx, not here — the native
 * File menu's "New Project…" needs to open it regardless of which screen
 * is currently showing, not just from this one's button.
 */
export default function NoProjectScreen({ onNewProject, onOpenProject, onTryDemo, recentsVersion }: NoProjectScreenProps) {
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
      <Box component="main" sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 3, pb: 10 }}>
        <Box sx={{ maxWidth: 560, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <BlockNodesIcon />
          <Typography component="h1" sx={{ fontSize: 32, fontWeight: 700, lineHeight: '38px', color: 'text.primary', mt: 2.5, mb: 1 }}>
            Build CFEngine policy visually
          </Typography>
          <Typography sx={{ color: 'text.muted', mb: 3 }}>Assemble policy from ready-made blocks instead of writing .cf files by hand.</Typography>
          <Stack direction="row" spacing={1.5} sx={{ mb: 3 }}>
            <Button variant="contained" color="primary" onClick={onNewProject}>
              New Project
            </Button>
            <Button variant="outlined" color="primary" onClick={() => onOpenProject()}>
              Open Project…
            </Button>
          </Stack>
          <RecentProjects onOpen={onOpenProject} version={recentsVersion} />

          <Divider sx={{ width: '100%', '&::before, &::after': { borderColor: 'divider' } }}>
            <Typography sx={{ fontSize: 12, color: 'text.muted', px: 1 }}>or explore</Typography>
          </Divider>

          <ButtonBase
            onClick={onTryDemo}
            sx={{
              width: '100%',
              mt: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              p: 1.5,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: '8px',
              bgcolor: 'background.paper',
              cursor: 'pointer',
              textAlign: 'left',
              '&:hover, &.Mui-focusVisible': { borderColor: 'primary.main' }
            }}
          >
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: '6px',
                bgcolor: 'action.hover',
                color: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <PlayArrowIcon sx={{ fontSize: 20 }} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 700, color: 'text.primary' }}>Try Demo: Web Server Hardening</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.muted' }}>Provisions and hardens an nginx web server, across 2 files</Typography>
            </Box>
            <ChevronRightIcon sx={{ color: 'text.muted', flexShrink: 0 }} />
          </ButtonBase>
        </Box>
      </Box>

      <StatusBar
        left={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Typography sx={{ fontSize: 11, color: 'text.muted' }}>Ready</Typography>
            <Typography sx={{ fontSize: 11, color: 'divider' }}>|</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.muted' }}>No project open</Typography>
          </Stack>
        }
      />
    </Box>
  );
}
