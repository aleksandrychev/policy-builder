import { StreamLanguage, type StringStream } from '@codemirror/language';

// A light CFEngine policy mode for reading generated .cf: comments, strings
// (with their $(…) references), bundle/body headers, promise types, class
// guards, attributes and function calls. Not a parser — just enough colour.
interface State {
  // What the next words of a `bundle agent name` / `body perms name` header are.
  header: 'kind' | 'name' | null;
  // Inside a string, the quote that closes it.
  quote: string | null;
}

function inString(stream: StringStream, state: State): string {
  if (stream.match(/^\$[({][^()${}]*[)}]/)) return 'variableName.special';
  while (!stream.eol()) {
    const next = stream.peek();
    if (next === '\\') {
      stream.next();
      stream.next();
      continue;
    }
    if (next === state.quote) {
      stream.next();
      state.quote = null;
      break;
    }
    if (next === '$' && stream.match(/^\$[({][^()${}]*[)}]/, false)) break;
    stream.next();
  }
  return 'string';
}

// `agent` then `name` in `bundle agent name`.
function headerWord(state: State): string {
  const kind = state.header;
  state.header = kind === 'kind' ? 'name' : null;
  return kind === 'kind' ? 'typeName' : 'variableName.definition';
}

// The first word of a line: a bundle/body header, a class guard or a promise type.
function lineStart(stream: StringStream, state: State): string | null {
  if (stream.match(/^(bundle|body|promise)\b/)) {
    state.header = 'kind';
    return 'keyword';
  }
  if (stream.match(/^[\w.&|!()$]+::/)) return 'labelName';
  if (stream.match(/^\w+:(?!:)/)) return 'heading';
  return null;
}

export const cfengineLanguage = StreamLanguage.define<State>({
  startState: () => ({ header: null, quote: null }),
  token(stream, state) {
    if (state.quote) return inString(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.match(/^#.*/)) return 'comment';
    const quote = stream.match(/^["'`]/) as RegExpMatchArray | null;
    if (quote) {
      state.quote = quote[0];
      return inString(stream, state);
    }
    if (state.header && stream.match(/^[\w:]+/)) return headerWord(state);
    const first = /^\s*$/.test(stream.string.slice(0, stream.start)) ? lineStart(stream, state) : null;
    if (first) return first;
    if (stream.match(/^\w+(?=\s*=>)/)) return 'propertyName';
    if (stream.match(/^\w+(?=\()/)) return 'variableName.function';
    if (stream.match('=>')) return 'operator';
    if (stream.match(/^@\([^)]*\)/)) return 'variableName.special';
    if (stream.match(/^-?\d+(\.\d+)?\b/)) return 'number';
    if (stream.match(/^\w+/)) return null;
    stream.next();
    return null;
  }
});
