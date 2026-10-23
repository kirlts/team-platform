/** One thing a person did that can be taken back: how to undo it and how to do it again. */
export interface UndoOp {
    /** Short description for the tooltip of the buttons. */
    label: string;
    undo: () => unknown | Promise<unknown>;
    redo: () => unknown | Promise<unknown>;
}
export declare function createUndoCore(): {
    past: UndoOp[];
    future: UndoOp[];
    /** Runs `redo` (the change) and, if it succeeds, records the operation; a new operation clears what could be redone. */
    run(op: UndoOp): Promise<unknown>;
    undo(): Promise<void>;
    redo(): Promise<void>;
};
export type UndoCore = ReturnType<typeof createUndoCore>;
/**
 * A deletion that Deshacer takes back: `remove` is the DELETE (or the batch) and `restore` its `POST …/restore` or, for what
 * has no restore, the POST that creates it again with the data it had.
 */
export declare function deletion(label: string, remove: () => unknown | Promise<unknown>, restore: () => unknown | Promise<unknown>): UndoOp;
/** An edit of one value: `apply` writes it, so undoing is writing the previous one and redoing the next. */
export declare function edit<T>(label: string, apply: (value: T) => unknown | Promise<unknown>, before: T, after: T): UndoOp;
