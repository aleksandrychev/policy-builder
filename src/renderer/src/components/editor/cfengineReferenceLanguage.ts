import { StreamLanguage } from '@codemirror/language';

// Highlights $(name)/${name} scalar references — CFEngine's own variable
// substitution syntax for plain promise text (as opposed to mustacheLanguage,
// which is only for an actual Mustache template body). Not a full grammar —
// this editor doesn't need one, just a visual cue for where a reference is.
export const cfengineReferenceLanguage = StreamLanguage.define<null>({
  token(stream) {
    if (stream.match(/^\$[({][^()${}]*[)}]/)) return 'keyword';
    if (stream.match(/^[^$]+/)) return null;
    stream.next();
    return null;
  }
});
