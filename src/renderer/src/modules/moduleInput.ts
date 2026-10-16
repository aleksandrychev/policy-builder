import type { ModuleInputResponse } from '../store/modulesSlice';
import type { ModuleInputField, ModuleInputQuestion } from './catalog';

// The input types the form edits: text, and lists of texts or of rows of texts.
const isText = (field: ModuleInputField) => field.type === 'string';

/** Whether the builder can answer a question: cfbs's other types (files…) aren't supported yet. */
export function isSupported(question: ModuleInputQuestion): boolean {
  if (question.type === 'string') return true;
  if (question.type !== 'list' || !question.subtype) return false;
  return Array.isArray(question.subtype) ? question.subtype.every(isText) : isText(question.subtype);
}

/** Whether a question has an answer cfbs can use: text, or a list with at least one entry. */
export function isAnswered(question: ModuleInputQuestion, response: ModuleInputResponse | undefined): boolean {
  if (question.type === 'string') return typeof response === 'string' && response.trim() !== '';
  return Array.isArray(response) && response.length > 0;
}

/** Whether a module still needs input: one of its questions has no answer. */
export const needsInput = (questions: ModuleInputQuestion[], answers: Record<string, ModuleInputResponse> | undefined) =>
  questions.some(question => question.variable && !isAnswered(question, answers?.[question.variable]));

/** A new list entry: the fields' defaults (a row), or the field's default (a text). */
export function newEntry(question: ModuleInputQuestion): Record<string, string> | string {
  const { subtype } = question;
  if (Array.isArray(subtype)) return Object.fromEntries(subtype.map(field => [field.key ?? '', field.default ?? '']));
  return subtype?.default ?? '';
}
