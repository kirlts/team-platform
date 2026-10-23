/** Maximum number of notices the bell keeps. It is a screen matter, not an operation matter. */
const MAX_NOTICES = 20;
export class EventsStore {
    snap = { progress: {}, notices: [], unread: 0, connected: false };
    listeners = new Set();
    doneListeners = new Set();
    messageListeners = new Set();
    subscribe = (fn) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };
    getSnapshot = () => this.snap;
    onDone(fn) {
        this.doneListeners.add(fn);
        return () => {
            this.doneListeners.delete(fn);
        };
    }
    onNewMessage(fn) {
        this.messageListeners.add(fn);
        return () => {
            this.messageListeners.delete(fn);
        };
    }
    set(next) {
        this.snap = { ...this.snap, ...next };
        for (const fn of this.listeners)
            fn();
    }
    setConnected(connected) {
        if (this.snap.connected !== connected)
            this.set({ connected });
    }
    progress(e) {
        const prev = this.snap.progress[e.job_id];
        // An event repeated by the replay does not move the bar backwards.
        const percent = prev && !prev.done ? Math.max(prev.percent, e.percent) : e.percent;
        this.set({
            progress: {
                ...this.snap.progress,
                [e.job_id]: { percent, phrase: e.phrase, code: e.code ?? null, vars: e.vars ?? {}, done: false, inputId: e.input_id ?? prev?.inputId },
            },
        });
    }
    done(e) {
        const prev = this.snap.progress[e.job_id];
        this.set({
            progress: {
                ...this.snap.progress,
                [e.job_id]: { percent: 100, phrase: prev?.phrase ?? '', code: prev?.code ?? null, vars: prev?.vars ?? {}, done: true, inputId: e.input_id ?? prev?.inputId },
            },
        });
        for (const fn of this.doneListeners)
            fn(e);
    }
    newMessage(e) {
        if (this.snap.notices.some((n) => n.key === e.message_id))
            return;
        const notice = {
            key: e.message_id,
            message_id: e.message_id,
            title: e.title,
            author_id: e.author_id,
            at: e.at ?? new Date().toISOString(),
        };
        this.set({ notices: [notice, ...this.snap.notices].slice(0, MAX_NOTICES), unread: this.snap.unread + 1 });
        for (const fn of this.messageListeners)
            fn(e);
    }
    markRead() {
        if (this.snap.unread !== 0)
            this.set({ unread: 0 });
    }
    forget(jobId) {
        if (!(jobId in this.snap.progress))
            return;
        const { [jobId]: _gone, ...rest } = this.snap.progress;
        this.set({ progress: rest });
    }
    /** Dispatches a server event. Accepts the names `progress`, `done` and `message`, or infers from the shape. */
    dispatch(kind, raw) {
        let data;
        try {
            data = JSON.parse(raw);
        }
        catch {
            return;
        }
        if (!data || typeof data !== 'object')
            return;
        const d = data;
        if (kind === 'done' || d.done === true) {
            if (typeof d.job_id === 'string')
                this.done({ job_id: d.job_id, input_id: str(d.input_id), input_status: str(d.input_status), done: true });
        }
        else if (kind === 'progress' || typeof d.percent === 'number') {
            if (typeof d.job_id === 'string' && typeof d.percent === 'number') {
                this.progress({
                    job_id: d.job_id,
                    input_id: str(d.input_id),
                    percent: d.percent,
                    phrase: typeof d.phrase === 'string' ? d.phrase : '',
                    code: typeof d.code === 'string' ? d.code : null,
                    vars: numbers(d.vars),
                    at: str(d.at),
                });
            }
        }
        else if (typeof d.message_id === 'string') {
            this.newMessage({
                message_id: d.message_id,
                title: typeof d.title === 'string' ? d.title : '',
                author_id: typeof d.author_id === 'string' ? d.author_id : '',
                at: str(d.at),
            });
        }
    }
}
function str(v) {
    return typeof v === 'string' ? v : undefined;
}
const CLOSED = 2;
/**
 * Wait before reopening a stream the server closed with a status other than 200 (the
 * browser does not retry that one). It is a courtesy to the server, not an operation deadline:
 * network drops are reconnected by the browser itself with Last-Event-ID.
 */
export const REOPEN_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000];
/** The browser's `EventSource`, with the session cookie. A runtime without one (Node, a test) passes its own factory. */
function defaultEventSource(url) {
    if (typeof EventSource === 'undefined')
        throw new Error('No EventSource in this runtime: pass an `eventSource` factory to createTeamClient.');
    return new EventSource(url, { withCredentials: true });
}
export const EVENT_NAMES = ['progress', 'done', 'message'];
/** Opens the stream and keeps it. Returns the function that closes it. */
export function connectEvents(store, url, factory = defaultEventSource, onReconnect) {
    let source = null;
    let timer;
    let attempt = 0;
    let hadError = false;
    let stopped = false;
    const open = () => {
        if (stopped)
            return;
        const es = factory(url);
        source = es;
        es.onopen = () => {
            attempt = 0;
            store.setConnected(true);
            // After a drop, what happened meanwhile arrives by replay; queries are refreshed just in case.
            if (hadError)
                onReconnect?.();
            hadError = false;
        };
        es.onerror = () => {
            hadError = true;
            store.setConnected(false);
            if (es.readyState === CLOSED && !stopped) {
                const delay = REOPEN_DELAYS_MS[Math.min(attempt, REOPEN_DELAYS_MS.length - 1)];
                attempt += 1;
                timer = setTimeout(open, delay);
            }
        };
        es.onmessage = (e) => store.dispatch(undefined, e.data);
        for (const name of EVENT_NAMES)
            es.addEventListener(name, (e) => store.dispatch(name, e.data));
    };
    open();
    return () => {
        stopped = true;
        if (timer)
            clearTimeout(timer);
        source?.close();
        store.setConnected(false);
    };
}
/** The numeric variables of a progress code; anything else is dropped. */
function numbers(v) {
    if (!v || typeof v !== 'object')
        return {};
    return Object.fromEntries(Object.entries(v).filter(([, n]) => typeof n === 'number'));
}
