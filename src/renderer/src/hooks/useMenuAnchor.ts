import { useState } from 'react';

/**
 * A menu's anchor, and whether to mount the menu at all: from its first opening on, so the
 * closing transition still plays. A closed MUI Menu still renders a Popover and a Modal, which
 * on every canvas block or arrow adds hundreds of components to each re-render.
 */
export function useMenuAnchor() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  return {
    anchor,
    mounted,
    open: (element: HTMLElement) => {
      setMounted(true);
      setAnchor(element);
    },
    close: () => setAnchor(null)
  };
}
