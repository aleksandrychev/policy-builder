import { Box, keyframes } from '@mui/material';

// AI-agent activity's colour: the CFEngine theme has no purple (nt-gui could adopt it as an AI accent).
export const AGENT_VIOLET = '#8B5CF6';
const glow = (alpha: number) => `rgba(139, 92, 246, ${alpha})`;

const sweep = keyframes`
  from { top: 0%; }
  to { top: 100%; }
`;

/**
 * Over the canvas while an AI agent works: a violet line with a soft light around it
 * sweeps top to bottom and back, like a scanner. Reduced motion: a still glowing edge.
 */
export function AgentScanOverlay() {
  return (
    <Box
      aria-hidden
      data-testid="agent-scan"
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 21,
        overflow: 'hidden',
        pointerEvents: 'none',
        '@media (prefers-reduced-motion: reduce)': { boxShadow: `inset 0 0 0 2px ${glow(0.7)}, inset 0 0 24px ${glow(0.35)}` }
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: 0,
          animation: `${sweep} 2.6s ease-in-out infinite alternate`,
          '@media (prefers-reduced-motion: reduce)': { display: 'none' },
          // The light: a soft band either side of the line.
          '&::before': {
            content: '""',
            position: 'absolute',
            left: 0,
            right: 0,
            top: -60,
            height: 120,
            background: `linear-gradient(180deg, transparent, ${glow(0.14)} 45%, ${glow(0.22)} 50%, ${glow(0.14)} 55%, transparent)`
          },
          // The line itself, brightest in the middle.
          '&::after': {
            content: '""',
            position: 'absolute',
            left: 0,
            right: 0,
            top: -1,
            height: 2,
            background: `linear-gradient(90deg, transparent, ${AGENT_VIOLET} 15%, #c4b5fd 50%, ${AGENT_VIOLET} 85%, transparent)`,
            boxShadow: `0 0 10px 2px ${glow(0.75)}, 0 0 28px 6px ${glow(0.35)}`
          }
        }}
      />
    </Box>
  );
}
