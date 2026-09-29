import type { SyntheticEvent } from 'react';

const stop = (event: SyntheticEvent) => event.stopPropagation();

// For menus opened from canvas nodes/edges: React passes portal events up to the node,
// where React Flow would take a click as selecting it and arrow keys as moving it.
export const stopCanvasEvents = { onClick: stop, onContextMenu: stop, onDoubleClick: stop, onKeyDown: stop };
