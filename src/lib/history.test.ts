import { describe, expect, it } from 'vitest';
import { exampleDiagram } from './diagram';
import { commitHistory, createHistory, HISTORY_LIMIT, redoHistory, undoHistory } from './history';

describe('diagram history', () => {
  it('restores deleted nodes and all connected edges together', () => {
    const doc = exampleDiagram();
    const deletedId = doc.nodes[1].id;
    const removed = { ...doc, nodes: doc.nodes.filter((node) => node.id !== deletedId), edges: doc.edges.filter((edge) => edge.source !== deletedId && edge.target !== deletedId) };
    const state = commitHistory(createHistory(doc), removed);
    const undone = undoHistory(state);
    expect(undone.present).toEqual(doc);
    expect(redoHistory(undone).present).toEqual(removed);
    expect(state.present).toEqual(removed);
  });
  it('snapshots inputs, clears redo after edits, and bounds history', () => {
    const doc = exampleDiagram();
    let state = createHistory(doc);
    doc.title = 'Changed outside history';
    expect(state.present.title).toBe('Order review');
    expect(commitHistory(state, state.present)).toBe(state);
    expect(undoHistory(state)).toBe(state);
    expect(redoHistory(state)).toBe(state);
    for (let index = 0; index < HISTORY_LIMIT + 4; index++) state = commitHistory(state, { ...state.present, title: `Edit ${index}` });
    expect(state.past).toHaveLength(HISTORY_LIMIT);
    state = undoHistory(state);
    expect(state.future).toHaveLength(1);
    state = commitHistory(state, { ...state.present, title: 'Another path' });
    expect(state.future).toEqual([]);
  });
});
