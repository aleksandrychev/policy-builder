import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Box, Button, ButtonBase, Divider, Stack, Typography } from '@mui/material';

import { StatusBar } from '../components/StatusBar';
import { BlockNodesIcon } from '../components/icons/BlockNodesIcon';
import { createNginxDemoProject } from '../demo/nginxDemoProject';
import { useAppDispatch } from '../store';

interface NoProjectScreenProps {
  onNewProject: () => void;
}

/**
 * First screen the app shows: no project has been created or opened yet.
 * The New Project dialog itself lives in App.tsx, not here — the native
 * File menu's "New Project…" needs to open it regardless of which screen
 * is currently showing, not just from this one's button.
 */
export default function NoProjectScreen({ onNewProject }: NoProjectScreenProps) {
  const dispatch = useAppDispatch();

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
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
            <Button variant="outlined" color="primary">
              Open Project…
            </Button>
          </Stack>

          <Divider sx={{ width: '100%', '&::before, &::after': { borderColor: 'divider' } }}>
            <Typography sx={{ fontSize: 12, color: 'text.muted', px: 1 }}>or explore</Typography>
          </Divider>

          <ButtonBase
            onClick={() => createNginxDemoProject(dispatch)}
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
        right={<Typography sx={{ fontSize: 11, color: 'text.muted', fontFamily: 'monospace' }}>CFEngine x.xx.xx</Typography>}
      />
    </Box>
  );
}
