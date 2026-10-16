import { useState } from 'react';

import type { SideView } from '../components/ActivityBar';

interface SideBarOptions {
  activeTab: number;
  maximized: boolean;
  setActiveTab: (tab: number) => void;
  setMaximized: (maximized: boolean) => void;
}

/**
 * The side bar's view and whether it's open, as VS Code's activity bar: clicking the open view
 * collapses it. It starts open on the canvas tabs and collapsed on Tests and Deployment, which
 * need the width; each remembers its own.
 */
export function useSideBar({ activeTab, maximized, setActiveTab, setMaximized }: SideBarOptions) {
  const [view, setView] = useState<SideView>('policy');
  const [openOnCanvas, setOpenOnCanvas] = useState(true);
  const [openElsewhere, setOpenElsewhere] = useState(false);
  const onCanvasTabs = activeTab < 2;
  const open = !maximized && (onCanvasTabs ? openOnCanvas : openElsewhere);
  const setOpen = onCanvasTabs ? setOpenOnCanvas : setOpenElsewhere;

  // A view, or null to collapse / reopen the one last open.
  const show = (next: SideView | null) => {
    if (maximized) {
      setMaximized(false);
      if (next) setView(next);
      setOpen(true);
      return;
    }
    if (next === null || (open && next === view)) {
      setOpen(!open);
      return;
    }
    setView(next);
    setOpen(true);
  };

  return {
    activeView: open ? view : null,
    show,
    // Properties: on the canvas tabs, unless a module's page covers them.
    showProperties: (pageOpen: boolean) => !maximized && onCanvasTabs && !pageOpen,
    // Opening a file or adding a block from Tests or Deployment goes to the canvas.
    toCanvas: () => {
      if (!onCanvasTabs) setActiveTab(0);
    }
  };
}
