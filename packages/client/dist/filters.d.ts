import type { Message } from './types.js';
export type FilterProp = 'for' | 'involved' | 'area' | 'status' | 'replies' | 'deleted';
export type FilterOp = 'eq' | 'neq';
export interface Filter {
    prop: FilterProp;
    op: FilterOp;
    value: string;
}
export interface MessageQuery {
    filters: Filter[];
    q: string;
}
export declare const FILTER_PROPS: FilterProp[];
export declare const REPLIES_VALUES: readonly ["con", "sin"];
export declare const STATUS_VALUES: readonly ["open", "answered", "closed"];
/** The only value of the «Borrados» filter: the deleted messages the person can restore (UD-250). */
export declare const DELETED_VALUE = "si";
/** Value of the «Para» filter meaning the person holding the session. */
export declare const ME = "me";
/** `?f=for:eq:me&f=status:neq:closed&q=texto` → query. One filter per property; invalid ones are ignored. */
export declare function parseQuery(params: URLSearchParams): MessageQuery;
export declare function serializeQuery(query: MessageQuery): URLSearchParams;
/** Replaces the filter of the same property or adds it. */
export declare function upsertFilter(filters: Filter[], next: Filter): Filter[];
export declare function removeFilter(filters: Filter[], prop: FilterProp): Filter[];
/** Parameters the server understands: equalities only. */
export declare function toApiParams(query: MessageQuery): URLSearchParams;
/** What the server does not filter: negations and «sin respuestas». */
export declare function applyClientFilters(messages: Message[], query: MessageQuery, meId: string): Message[];
/** Stable query key for TanStack Query. */
export declare function queryKeyOf(query: MessageQuery): string;
/** The query string `GET /messages` takes: the equalities of the filters and the text; `repliesFeed` adds the Inicio feed (only messages with replies, newest reply first). */
export declare function messagesQueryString(query: MessageQuery, repliesFeed?: boolean): string;
