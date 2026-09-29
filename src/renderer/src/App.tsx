import { useEffect, useState } from 'react';

import { NewProjectDialog } from './components/dialogs/NewProjectDialog';
import { createNginxDemoProject } from './demo/nginxDemoProject';
import NoProjectScreen from './pages/NoProjectScreen';
import ProjectView from './pages/ProjectView';
import { useAppDispatch, useAppSelector } from './store';
import { selectCurrentProject } from './store/projectSlice/selectors';

export default function App() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  // Owned here, not by NoProjectScreen, so the native File menu's "New
  // Project…" (main/index.ts's buildApplicationMenu) can open it regardless
  // of which screen is currently showing.
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(
    () =>
      window.api?.onMenuAction(action => {
        if (action === 'new-project') setNewProjectOpen(true);
        else if (action === 'try-demo') createNginxDemoProject(dispatch);
        // 'open-project' has no renderer behavior yet — mirrors the
        // still-inert "Open Project…" button on NoProjectScreen.
      }),
    [dispatch]
  );

  return (
    <>
      {project ? <ProjectView key={project.id} /> : <NoProjectScreen onNewProject={() => setNewProjectOpen(true)} />}
      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </>
  );
}
