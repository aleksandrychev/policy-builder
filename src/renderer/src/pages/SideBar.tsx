import type { ReactNode, Ref } from 'react';

import { Box } from '@mui/material';

import type { SideView } from '../components/ActivityBar';
import { ResizeHandle } from '../components/ResizeHandle';
import { ModulesView } from '../components/modules/ModulesView';
import type { useProjectModules } from './useProjectModules';

interface SideBarProps {
  modules: ReturnType<typeof useProjectModules>;
  onResize: (deltaPx: number) => void;
  onResizeEnd: () => void;
  // The Blocks palette above the Files explorer.
  policy: ReactNode;
  // The Modules view's search field, for ⌘F.
  searchModulesRef?: Ref<HTMLInputElement>;
  view: SideView | null;
  widthFraction: number;
}

/** The side bar right of the activity bar: the open view, and its resize handle. */
export function SideBar({ modules, onResize, onResizeEnd, policy, searchModulesRef, view, widthFraction }: SideBarProps) {
  if (!view) return null;
  return (
    <>
      <Box sx={{ width: `${widthFraction * 100}%`, flexShrink: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
        {view === 'modules' ? (
          <ModulesView
            key={modules.browsing.count}
            initialSearch={modules.browsing.search}
            canAdd={modules.canAdd}
            catalog={modules.catalog}
            projectModules={modules.projectModules}
            searchRef={searchModulesRef}
            selectedName={modules.openName}
            isNeedingInput={modules.isNeedingInput}
            onSelect={modules.open}
            onEditInput={modules.openInput}
            onAdd={modules.add}
            onRemove={modules.remove}
            usedBy={modules.usedBy}
          />
        ) : (
          policy
        )}
      </Box>
      <ResizeHandle label="Resize left sidebar" orientation="vertical" onResize={onResize} onResizeEnd={onResizeEnd} />
    </>
  );
}
