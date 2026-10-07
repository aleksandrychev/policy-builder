import { workBegan, workEnded } from './activity';
import { type Tool, str } from './shared';

/** The agent's own session: it locks the editor while it works and says what it's doing. */
export const WORK_TOOLS: Record<string, Tool> = {
  begin_work: (_env, input) => {
    workBegan(str(input, 'task'));
    return { locked: true, note: 'The editor is locked for the user until end_work (or 5 minutes without a call).' };
  },
  end_work: () => {
    workEnded();
    return { locked: false };
  }
};
