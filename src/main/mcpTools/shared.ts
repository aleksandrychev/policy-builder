export type CallWindow = (name: string, input: unknown) => Promise<string>;
// A tool's callback: the window's answer as MCP text content, its failure as an error result.
export type Answer = (name: string) => (input: unknown) => Promise<{ content: { text: string; type: 'text' }[]; isError?: boolean }>;

export const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
export const EDIT = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
export const REMOVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false } as const;

export function answerWith(call: CallWindow): Answer {
  // Every tool declares an inputSchema (empty for none): without one the SDK passes its request context instead of the arguments.
  return name => async input => {
    try {
      return { content: [{ type: 'text', text: await call(name, input ?? {}) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  };
}
