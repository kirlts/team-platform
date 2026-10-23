/** Lists may arrive as an array or as `{ items }`. */
export function unwrapList(data) {
    if (Array.isArray(data))
        return data;
    if (data && typeof data === 'object' && Array.isArray(data.items)) {
        return data.items;
    }
    return [];
}
