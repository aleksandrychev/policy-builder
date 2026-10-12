import { act, fireEvent, screen } from '@testing-library/react';

import { agentActivity, callEnded, callStarted, resetActivity, useAgentActivity } from '../../mcp/activity';
import { CHOSEN_AGENT_KEY } from '../../mcp/agents';
import { renderWithProviders } from '../../test/render';
import { AgentActivityBar } from './AgentActivityBar';

function Bar() {
  return <AgentActivityBar activity={useAgentActivity()} onToggleLog={() => {}} />;
}

describe('AgentActivityBar', () => {
  beforeEach(() => {
    resetActivity();
    localStorage.setItem(CHOSEN_AGENT_KEY, 'gemini-cli');
  });
  afterEach(() => localStorage.clear());

  it('after Stop, says where to answer the agent, and Allow again confirms before hiding', () => {
    vi.useFakeTimers();
    act(() => void callEnded(callStarted('get_file', 'Read a file'), true));
    renderWithProviders(<Bar />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(agentActivity().paused).toBe(true);
    expect(screen.getByText(/answer it in Gemini CLI/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Allow again' }));
    expect(agentActivity().paused).toBe(false);
    expect(screen.getByText('The AI agent may work again')).toBeInTheDocument();
    expect(screen.getByText('Tell it in Gemini CLI to continue.')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
