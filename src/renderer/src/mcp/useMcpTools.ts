import { useEffect, useRef } from 'react';
import { useStore } from 'react-redux';

import type { AppDispatch, RootState } from '../store';
import type { CanvasEnv, SessionTools, ToolEnv } from './shared';
import { answerTool } from './tools';

// The open project's canvas, registered by the project view while it's mounted.
let canvas: ToolEnv['canvas'] = null;

/** The project view's part of the tools: its canvas, while a project is open. */
export function useMcpCanvas(env: Omit<CanvasEnv, 'dispatch' | 'getState'>) {
  const latest = useRef(env);
  useEffect(() => {
    latest.current = env;
  });
  useEffect(() => {
    const registered: ToolEnv['canvas'] = {
      get selectedInstanceId() {
        return latest.current.selectedInstanceId;
      },
      fitView: () => latest.current.fitView(),
      nodeHeight: nodeId => latest.current.nodeHeight(nodeId),
      openFile: fileId => latest.current.openFile(fileId),
      sizeOf: instance => latest.current.sizeOf(instance)
    };
    canvas = registered;
    return () => {
      if (canvas === registered) canvas = null;
    };
  }, []);
}

const CANVAS_WAIT_MS = 3000;

// Just after a project opens, its view mounts a moment later: tools wait for its canvas.
async function canvasWhenMounted(getState: () => RootState): Promise<ToolEnv['canvas']> {
  for (let waited = 0; !canvas && getState().project && waited < CANVAS_WAIT_MS; waited += 50) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return canvas;
}

/** Answers AI agents' tool calls (over MCP, through main) for the whole app. */
export function useMcpTools(session: SessionTools) {
  const store = useStore<RootState>();
  const latest = useRef(session);
  useEffect(() => {
    latest.current = session;
  });

  // Subscribed again on every render: the listener always reads this module's canvas (hot reload replaces it).
  useEffect(() =>
    window.api?.onMcpToolRequest((requestId, name, input) => {
      void canvasWhenMounted(store.getState)
        .then(mounted =>
          answerTool({ canvas: mounted, dispatch: store.dispatch as AppDispatch, getState: store.getState, session: latest.current }, name, input)
        )
        .then(answer => window.api?.mcpToolResult(requestId, answer));
    })
  );
}
