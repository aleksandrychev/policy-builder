import { Box } from '@mui/material';

interface ResizeHandleProps {
  label?: string;
  onResize: (delta: number) => void;
  onResizeEnd?: () => void;
  orientation: 'horizontal' | 'vertical';
}

/**
 * A thin draggable strip between two panels. "vertical" drags left/right to
 * resize a width; "horizontal" drags up/down to resize a height. onResize
 * fires with the pointer's delta since the last event — the caller decides
 * which direction that grows.
 */
const KEYBOARD_STEP = 16;

export function ResizeHandle({ orientation, onResize, onResizeEnd, label = 'Resize panel' }: ResizeHandleProps) {
  // Arrow keys along the drag axis move by a fixed step, as a drag of that many pixels would.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const [back, forward] = orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (event.key !== back && event.key !== forward) return;
    event.preventDefault();
    onResize(event.key === forward ? KEYBOARD_STEP : -KEYBOARD_STEP);
    onResizeEnd?.();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    let lastPos = orientation === 'vertical' ? event.clientX : event.clientY;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const pos = orientation === 'vertical' ? moveEvent.clientX : moveEvent.clientY;
      onResize(pos - lastPos);
      lastPos = pos;
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      onResizeEnd?.();
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // The visible strip stays hairline-thin (1px, like a normal border) so it
  // doesn't read as a thick gutter; a wider invisible ::before extends the
  // actual pointer hit area without taking up extra layout space.
  return (
    <Box
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      tabIndex={0}
      sx={{
        flexShrink: 0,
        position: 'relative',
        bgcolor: 'divider',
        transition: 'background-color 0.1s',
        '&:hover, &:focus-visible': { bgcolor: 'primary.main' },
        ...(orientation === 'vertical'
          ? { width: '1px', cursor: 'col-resize', '&::before': { content: '""', position: 'absolute', top: 0, bottom: 0, left: -3, right: -3 } }
          : { height: '1px', cursor: 'row-resize', '&::before': { content: '""', position: 'absolute', left: 0, right: 0, top: -3, bottom: -3 } })
      }}
    />
  );
}
