import { useCallback, useEffect, useRef, useState } from 'react';

// Fractions (0-1) of the surrounding container, not pixels — a pixel width
// stays fixed while the window resizes around it, so sidebars would end up
// disproportionately huge on a small window and tiny on a large one.
export interface LayoutSettings {
  leftSidebarFraction: number;
  paletteHeightFraction: number;
  rightSidebarFraction: number;
}

export const LEFT_SIDEBAR_MIN = 0.16;
export const LEFT_SIDEBAR_MAX = 0.35;
export const RIGHT_SIDEBAR_MIN = 0.22;
export const RIGHT_SIDEBAR_MAX = 0.5;
export const PALETTE_HEIGHT_MIN = 0.2;
export const PALETTE_HEIGHT_MAX = 0.85;

// Right sidebar wider / canvas thinner than a plain even split by default —
// Properties needs the room more than the canvas does.
const DEFAULT_LAYOUT: LayoutSettings = {
  leftSidebarFraction: 0.2,
  paletteHeightFraction: 0.62,
  rightSidebarFraction: 0.32
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// A saved value outside its range (or not a number at all) falls back to the default.
function validFraction(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function sanitizeLayout(saved: Partial<LayoutSettings>): LayoutSettings {
  return {
    leftSidebarFraction: validFraction(saved.leftSidebarFraction, LEFT_SIDEBAR_MIN, LEFT_SIDEBAR_MAX, DEFAULT_LAYOUT.leftSidebarFraction),
    paletteHeightFraction: validFraction(saved.paletteHeightFraction, PALETTE_HEIGHT_MIN, PALETTE_HEIGHT_MAX, DEFAULT_LAYOUT.paletteHeightFraction),
    rightSidebarFraction: validFraction(saved.rightSidebarFraction, RIGHT_SIDEBAR_MIN, RIGHT_SIDEBAR_MAX, DEFAULT_LAYOUT.rightSidebarFraction)
  };
}

/**
 * Sidebar/palette sizes, persisted to disk via the main process (see
 * layout:get/layout:set in src/main/index.ts) so they survive an app
 * restart. Falls back to defaults when window.api is absent (tests) or no
 * file has been saved yet.
 */
export function useLayoutSettings() {
  const [layout, setLayout] = useState<LayoutSettings>(DEFAULT_LAYOUT);
  const layoutRef = useRef(layout);
  const loaded = useRef(false);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    window.api
      ?.getLayoutSettings()
      .then(saved => {
        if (saved) setLayout(sanitizeLayout(saved));
      })
      .catch((error: unknown) => console.error('Failed to load layout settings:', error))
      .finally(() => {
        loaded.current = true;
      });
  }, []);

  const commitLayout = useCallback(() => {
    // Guards against a resize finishing before the initial load resolves,
    // which would overwrite a previously-saved file with in-flight defaults.
    if (!loaded.current) return;
    window.api?.setLayoutSettings(layoutRef.current);
  }, []);

  return { layout, setLayout, commitLayout };
}
