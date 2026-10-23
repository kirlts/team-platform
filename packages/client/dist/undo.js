// Undo and redo, without a screen: two lists and the rules between them. Memory only: nothing here is persisted and a
// reload empties it. The change and its reverse are the operations of the API (a delete and its `restore`, a PATCH and the
// PATCH with the previous value), so what undoes a change is as durable as the API.
export function createUndoCore() {
    const past = [];
    const future = [];
    return {
        past,
        future,
        /** Runs `redo` (the change) and, if it succeeds, records the operation; a new operation clears what could be redone. */
        async run(op) {
            const result = await op.redo();
            past.push(op);
            future.length = 0;
            return result;
        },
        async undo() {
            const op = past[past.length - 1];
            if (!op)
                return;
            await op.undo();
            past.pop();
            future.push(op);
        },
        async redo() {
            const op = future[future.length - 1];
            if (!op)
                return;
            await op.redo();
            future.pop();
            past.push(op);
        },
    };
}
/**
 * A deletion that Deshacer takes back: `remove` is the DELETE (or the batch) and `restore` its `POST …/restore` or, for what
 * has no restore, the POST that creates it again with the data it had.
 */
export function deletion(label, remove, restore) {
    return { label, redo: remove, undo: restore };
}
/** An edit of one value: `apply` writes it, so undoing is writing the previous one and redoing the next. */
export function edit(label, apply, before, after) {
    return { label, redo: () => apply(after), undo: () => apply(before) };
}
