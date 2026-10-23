// Upload of an input with progress. `fetch` does not give upload progress portably (report 07, §6.3), so XMLHttpRequest is
// used. The retry resends everything: it is safe because POST /inputs is idempotent by hash (MASTER-SPEC §1.3).
import { CLIENT_ERROR_CODES, TeamApiError } from './errors.js';
import { inputForm } from './multipart.js';
import { pathOf, routes } from './routes.js';
export function uploadInput(transport, input, onProgress, signal) {
    return new Promise((resolve, reject) => {
        const form = inputForm(input);
        const path = pathOf(routes.inputCreate);
        const xhr = transport.xhr ? transport.xhr() : new XMLHttpRequest();
        xhr.open('POST', transport.url(path));
        xhr.withCredentials = transport.credentials === 'include';
        for (const [name, value] of Object.entries(transport.headersFor('POST')))
            xhr.setRequestHeader(name, value);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0)
                onProgress(e.loaded / e.total);
        };
        const settle = transport.instrument?.('POST', path) ?? (() => undefined); // interface telemetry (UD-091): the send begins here
        xhr.onload = () => {
            settle({ status: xhr.status });
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(JSON.parse(xhr.responseText));
                }
                catch {
                    reject(new TeamApiError(xhr.status, '', CLIENT_ERROR_CODES.invalidResponse));
                }
                return;
            }
            let message = '';
            let code = `http_${xhr.status}`;
            let details = {};
            try {
                const body = JSON.parse(xhr.responseText);
                if (typeof body?.message === 'string')
                    message = body.message;
                if (typeof body?.code === 'string')
                    code = body.code;
                if (body && typeof body === 'object') {
                    const { code: _code, message: _message, ...rest } = body;
                    details = rest;
                }
            }
            catch {
                // No JSON body: the HTTP status remains.
            }
            reject(new TeamApiError(xhr.status, message, code, details));
        };
        xhr.onerror = () => {
            settle({ status: 0 });
            reject(new TeamApiError(0, '', CLIENT_ERROR_CODES.network));
        };
        xhr.onabort = () => reject(new TeamApiError(0, '', CLIENT_ERROR_CODES.cancelled));
        signal?.addEventListener('abort', () => xhr.abort());
        xhr.send(form);
    });
}
