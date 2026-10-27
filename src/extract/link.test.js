import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { extract } from './index.js';

const ARTICLE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Cómo reportar un error</title>
<script>var tracking = "no debe aparecer";</script><style>.x{color:red}</style></head>
<body><nav><a href="/">Inicio</a> <a href="/blog">Blog</a></nav>
<article><h1>Cómo reportar un error</h1>
<p>Un buen reporte dice qué se esperaba y qué pasó. Debe incluir los pasos para reproducirlo, la pantalla donde ocurre y una captura cuando sea posible, para que quien lo recibe no tenga que preguntar.</p>
<h2>Pasos</h2><ul><li>Abrir la pantalla de pagos</li><li>Apretar <strong>Confirmar</strong></li></ul>
<p>Más detalle en <a href="/guia">la guía</a> del equipo, que explica cómo se clasifica cada mensaje que llega a la bandeja y quién lo responde primero. Si el error es de datos, adjuntar el archivo.</p>
<p>Cada reporte se asigna a la persona que conoce el dominio afectado, y se cierra cuando quien lo abrió confirma que el arreglo funciona en su propio equipo.</p></article>
<footer>Todos los derechos reservados</footer></body></html>`;

let server;
let base;
const hits = [];
let dripClosed = () => {};
const PRIVATE = ['127.0.0.1'];

before(async () => {
  server = createServer((req, res) => {
    hits.push(req.url);
    const url = new URL(req.url, 'http://x');
    switch (url.pathname) {
      case '/articulo':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(ARTICLE);
      case '/latin1': {
        res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' });
        return res.end(Buffer.from('<html><head><title>Año</title></head><body><article><p>' + 'camión pequeño ñandú '.repeat(30) + '</p></article></body></html>', 'latin1'));
      }
      case '/texto':
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('línea uno\nlínea dos\n');
      case '/redirige':
        res.writeHead(302, { location: '/articulo' });
        return res.end();
      case '/redirige-adentro':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        return res.end();
      case '/bucle':
        res.writeHead(302, { location: '/bucle' });
        return res.end();
      case '/no-existe':
        res.writeHead(404, { 'content-type': 'text/html' });
        return res.end('nada');
      case '/pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' });
        return res.end('%PDF-1.4');
      case '/enorme': {
        res.writeHead(200, { 'content-type': 'text/html' });
        const chunk = '<p>' + 'texto de relleno para llenar la página '.repeat(200) + '</p>\n';
        let sent = 0;
        const timer = setInterval(() => {
          if (sent++ > 400 || res.destroyed) {
            clearInterval(timer);
            return res.end();
          }
          res.write(chunk);
        }, 1);
        res.on('close', () => clearInterval(timer));
        return;
      }
      case '/cuelga':
        return; // never responds
      case '/gotea': {
        // Headers at once, then one byte every 50 ms: the site answers, but too slowly to finish.
        res.writeHead(200, { 'content-type': 'text/html' });
        const drip = setInterval(() => res.write('x'), 50);
        res.on('close', () => {
          clearInterval(drip);
          dripClosed();
        });
        return;
      }
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const link = (url) => ({ id: 'l1', kind: 'link', path: url, mime: 'text/uri-list', size: 0 });
const cfg = (link = {}) => ({ link: { allowedPrivateHosts: PRIVATE, ...link } });

test('an article becomes markdown with title, structure and source, without menu or scripts', async () => {
  const progress = [];
  const { text, meta } = await extract(link(`${base}/articulo`), { config: cfg(), onProgress: (p) => progress.push(p) });
  assert.match(text, /^# Cómo reportar un error/);
  assert.match(text, /^## Pasos$/m);
  assert.match(text, /^-\s+Abrir la pantalla de pagos$/m);
  assert.match(text, /\*\*Confirmar\*\*/);
  assert.match(text, /\[la guía\]\(http:\/\/127\.0\.0\.1:\d+\/guia\)/, 'relative links become absolute');
  assert.equal(text.includes('tracking'), false);
  assert.equal(text.includes('color:red'), false);
  assert.equal(text.includes('Todos los derechos reservados'), false);
  assert.ok(text.endsWith(`Fuente: ${base}/articulo`));
  assert.equal(meta.title, 'Cómo reportar un error');
  assert.equal(meta.readable, true);
  assert.equal(meta.status, 200);
  assert.equal(progress.at(-1), 100);
});

test('the encoding is taken from the header', async () => {
  const { text } = await extract(link(`${base}/latin1`), { config: cfg() });
  assert.ok(text.includes('camión pequeño ñandú'));
});

test('plain text passes as is', async () => {
  const { text } = await extract(link(`${base}/texto`), { config: cfg() });
  assert.ok(text.startsWith('línea uno\nlínea dos'));
});

test('a redirect is followed by hand and each hop is requested', async () => {
  hits.length = 0;
  const { meta } = await extract(link(`${base}/redirige`), { config: cfg() });
  assert.equal(meta.redirects, 1);
  assert.deepEqual(hits, ['/redirige', '/articulo']);
  assert.equal(meta.finalUrl, `${base}/articulo`);
});

test('a redirect to an internal address is blocked without requesting it', async () => {
  await assert.rejects(extract(link(`${base}/redirige-adentro`), { config: cfg() }), (e) => e.code === 'link_blocked' && e.details.host === '169.254.169.254');
});

test('a redirect loop is cut at the maximum', async () => {
  hits.length = 0;
  await assert.rejects(extract(link(`${base}/bucle`), { config: cfg({ maxRedirects: 3 }) }), (e) => e.code === 'link_too_many_redirects');
  assert.equal(hits.length, 4);
});

test('by default localhost and private IPs are blocked, even if the server exists', async () => {
  hits.length = 0;
  for (const url of [`${base}/articulo`, `http://localhost:${server.address().port}/articulo`, 'http://169.254.169.254/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://metadata.google.internal/']) {
    await assert.rejects(extract(link(url)), (e) => e.code === 'link_blocked', url);
  }
  assert.deepEqual(hits, [], 'no request reached the server');
});

test('only http and https are accepted, without user or password', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'no es una dirección', 'http://usuario:clave@example.com/']) {
    await assert.rejects(extract(link(url)), (e) => e.code === 'link_invalid', url);
  }
});

test('the connection goes to the already validated address and not to a second resolution of the name', async () => {
  // `app.example.test` exists in no DNS: it is reachable only because the connection goes to the pinned address.
  const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  const port = server.address().port;
  const { text } = await extract(link(`http://app.example.test:${port}/articulo`), { config: cfg({ allowedPrivateHosts: ['app.example.test'] }), deps: { lookup } });
  assert.match(text, /Cómo reportar un error/);
});

test('a name that resolves to a private address is blocked even if the name looks public', async () => {
  const lookup = async () => [{ address: '10.0.0.7', family: 4 }];
  await assert.rejects(extract(link('http://publico.example/'), { deps: { lookup } }), (e) => e.code === 'link_blocked');
});

test('a page larger than the cap is cut in the stream and warns', async () => {
  const { meta } = await extract(link(`${base}/enorme`), { config: cfg({ maxBytes: 20_000 }) });
  assert.equal(meta.truncated, true);
  assert.equal(meta.bytes, 20_000);
  assert.equal(meta.warnings[0].code, 'link_truncated');
});

test('a site that does not respond is cut at the deadline', async () => {
  const t = performance.now();
  await assert.rejects(extract(link(`${base}/cuelga`), { config: cfg({ timeoutMs: 300 }) }), (e) => e.code === 'link_timeout');
  assert.ok(performance.now() - t < 3000);
});

test('a site that answers but delivers its bytes slowly is cut at the deadline and the connection is released (TASK-013)', async () => {
  const closed = new Promise((resolve) => { dripClosed = resolve; });
  const t = performance.now();
  await assert.rejects(extract(link(`${base}/gotea`), { config: cfg({ timeoutMs: 400 }) }), (e) => e.code === 'link_timeout' && e.details.timeoutMs === 400);
  const elapsed = performance.now() - t;
  assert.ok(elapsed >= 350 && elapsed < 3000, `cut at the deadline, not before or long after (took ${Math.round(elapsed)} ms)`);
  await closed; // the server saw the socket close: nothing keeps downloading in the background
});

test('cancelling with the signal cuts the download', async () => {
  const controller = new AbortController();
  const pending = extract(link(`${base}/cuelga`), { config: cfg(), signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, (e) => e.code === 'aborted');
});

test('an HTTP error code and a type that is not a page are rejected with a reason', async () => {
  await assert.rejects(extract(link(`${base}/no-existe`), { config: cfg() }), (e) => e.code === 'link_http_error' && e.details.status === 404);
  await assert.rejects(extract(link(`${base}/pdf`), { config: cfg() }), (e) => e.code === 'link_unsupported_type');
});

test('a closed port is a connection error, not a hang', async () => {
  await assert.rejects(extract(link('http://127.0.0.1:1/'), { config: cfg() }), (e) => e.code === 'link_fetch_failed');
});
