import { type Diagram, validateDiagram } from './diagram';

export interface History { past: Diagram[]; present: Diagram; future: Diagram[] }
export const HISTORY_LIMIT = 100;
const clone = (doc: Diagram) => validateDiagram(doc);
export function createHistory(doc: Diagram): History {
  return { past: [], present: clone(doc), future: [] };
}
export function commitHistory(state: History, doc: Diagram): History {
  const next = clone(doc);
  if (JSON.stringify(state.present) === JSON.stringify(next)) return state;
  return { past: [...state.past, clone(state.present)].slice(-HISTORY_LIMIT), present: next, future: [] };
}
export function undoHistory(state: History): History {
  if (!state.past.length) return state;
  return { past: state.past.slice(0, -1), present: clone(state.past[state.past.length - 1]), future: [clone(state.present), ...state.future] };
}
export function redoHistory(state: History): History {
  if (!state.future.length) return state;
  return { past: [...state.past, clone(state.present)].slice(-HISTORY_LIMIT), present: clone(state.future[0]), future: state.future.slice(1) };
}
