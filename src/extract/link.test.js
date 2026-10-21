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
        return; // nunca responde
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

test('un artículo queda como markdown con título, estructura y fuente, sin menú ni scripts', async () => {
  const progress = [];
  const { text, meta } = await extract(link(`${base}/articulo`), { config: cfg(), onProgress: (p) => progress.push(p) });
  assert.match(text, /^# Cómo reportar un error/);
  assert.match(text, /^## Pasos$/m);
  assert.match(text, /^-\s+Abrir la pantalla de pagos$/m);
  assert.match(text, /\*\*Confirmar\*\*/);
  assert.match(text, /\[la guía\]\(http:\/\/127\.0\.0\.1:\d+\/guia\)/, 'los enlaces relativos se vuelven absolutos');
  assert.equal(text.includes('tracking'), false);
  assert.equal(text.includes('color:red'), false);
  assert.equal(text.includes('Todos los derechos reservados'), false);
  assert.ok(text.endsWith(`Fuente: ${base}/articulo`));
  assert.equal(meta.title, 'Cómo reportar un error');
  assert.equal(meta.readable, true);
  assert.equal(meta.status, 200);
  assert.equal(progress.at(-1), 100);
});

test('la codificación se toma de la cabecera', async () => {
  const { text } = await extract(link(`${base}/latin1`), { config: cfg() });
  assert.ok(text.includes('camión pequeño ñandú'));
});

test('un texto plano pasa tal cual', async () => {
  const { text } = await extract(link(`${base}/texto`), { config: cfg() });
  assert.ok(text.startsWith('línea uno\nlínea dos'));
});

test('una redirección se sigue a mano y cada salto se pide', async () => {
  hits.length = 0;
  const { meta } = await extract(link(`${base}/redirige`), { config: cfg() });
  assert.equal(meta.redirects, 1);
  assert.deepEqual(hits, ['/redirige', '/articulo']);
  assert.equal(meta.finalUrl, `${base}/articulo`);
});

test('una redirección hacia una dirección interna se bloquea sin pedirla', async () => {
  await assert.rejects(extract(link(`${base}/redirige-adentro`), { config: cfg() }), (e) => e.code === 'link_blocked' && e.details.host === '169.254.169.254');
});

test('un bucle de redirecciones se corta en el máximo', async () => {
  hits.length = 0;
  await assert.rejects(extract(link(`${base}/bucle`), { config: cfg({ maxRedirects: 3 }) }), (e) => e.code === 'link_too_many_redirects');
  assert.equal(hits.length, 4);
});

test('por omisión localhost y las IP privadas están bloqueadas, aunque el servidor exista', async () => {
  hits.length = 0;
  for (const url of [`${base}/articulo`, `http://localhost:${server.address().port}/articulo`, 'http://169.254.169.254/', 'http://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'http://metadata.google.internal/']) {
    await assert.rejects(extract(link(url)), (e) => e.code === 'link_blocked', url);
  }
  assert.deepEqual(hits, [], 'ninguna solicitud llegó al servidor');
});

test('sólo se admiten http y https, sin usuario ni contraseña', async () => {
  for (const url of ['file:///etc/passwd', 'ftp://example.com/', 'javascript:alert(1)', 'no es una dirección', 'http://usuario:clave@example.com/']) {
    await assert.rejects(extract(link(url)), (e) => e.code === 'link_invalid', url);
  }
});

test('la conexión va a la dirección ya validada y no a una segunda resolución del nombre', async () => {
  // `app.example.test` no existe en ningún DNS: sólo se alcanza porque se conecta a la dirección fijada.
  const lookup = async () => [{ address: '127.0.0.1', family: 4 }];
  const port = server.address().port;
  const { text } = await extract(link(`http://app.example.test:${port}/articulo`), { config: cfg({ allowedPrivateHosts: ['app.example.test'] }), deps: { lookup } });
  assert.match(text, /Cómo reportar un error/);
});

test('un nombre que resuelve a una dirección privada se bloquea aunque el nombre parezca público', async () => {
  const lookup = async () => [{ address: '10.0.0.7', family: 4 }];
  await assert.rejects(extract(link('http://publico.example/'), { deps: { lookup } }), (e) => e.code === 'link_blocked');
});

test('una página mayor que el tope se corta en el flujo y avisa', async () => {
  const { meta } = await extract(link(`${base}/enorme`), { config: cfg({ maxBytes: 20_000 }) });
  assert.equal(meta.truncated, true);
  assert.equal(meta.bytes, 20_000);
  assert.equal(meta.warnings[0].code, 'link_truncated');
});

test('un sitio que no responde se corta en el plazo', async () => {
  const t = performance.now();
  await assert.rejects(extract(link(`${base}/cuelga`), { config: cfg({ timeoutMs: 300 }) }), (e) => e.code === 'link_timeout');
  assert.ok(performance.now() - t < 3000);
});

test('cancelar con la señal corta la descarga', async () => {
  const controller = new AbortController();
  const pending = extract(link(`${base}/cuelga`), { config: cfg(), signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, (e) => e.code === 'aborted');
});

test('un código de error HTTP y un tipo que no es página se rechazan con motivo', async () => {
  await assert.rejects(extract(link(`${base}/no-existe`), { config: cfg() }), (e) => e.code === 'link_http_error' && e.details.status === 404);
  await assert.rejects(extract(link(`${base}/pdf`), { config: cfg() }), (e) => e.code === 'link_unsupported_type');
});

test('un puerto cerrado es un error de conexión, no un cuelgue', async () => {
  await assert.rejects(extract(link('http://127.0.0.1:1/'), { config: cfg() }), (e) => e.code === 'link_fetch_failed');
});
