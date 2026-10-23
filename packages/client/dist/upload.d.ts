import type { Transport } from './http.js';
import type { CreatedInput, NewInput } from './types.js';
export declare function uploadInput(transport: Transport, input: NewInput, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<CreatedInput>;
