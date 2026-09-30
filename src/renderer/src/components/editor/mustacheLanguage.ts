import { StreamLanguage } from '@codemirror/language';

// Highlights {{tag}} and {{{tag}}} runs as a single token; everything else is
// plain text. Not a full grammar — CFEngine mustache templates don't need one
// for a properties-panel editor.
export const mustacheLanguage = StreamLanguage.define<null>({
  token(stream) {
    if (stream.match(/^\{\{\{?[^{}]*\}\}\}?/)) return 'keyword';
    if (stream.match(/^[^{]+/)) return null;
    stream.next();
    return null;
  }
});
