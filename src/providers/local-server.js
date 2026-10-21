// Local HTTP server for provider tests: records each request and replies whatever
// the test tells it to. This way the real shape of the request (headers, body) is tested without a network.
import { createServer } from 'node:http';

/**
 * @param {(req: {method: string, url: string, headers: object, body: string, json: any}, n: number) => {status?: number, headers?: object, body?: any}} handler
 */
export async function startLocalServer(handler) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    const record = { method: req.method, url: req.url, headers: req.headers, body, json };
    const n = requests.length;
    requests.push(record);
    const out = await handler(record, n);
    res.writeHead(out.status ?? 200, { 'content-type': 'application/json', ...(out.headers ?? {}) });
    res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}
