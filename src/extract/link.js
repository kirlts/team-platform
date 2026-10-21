// Link extractor (MASTER-SPEC §7.4, report 05 §7): download with size and time limits,
// SSRF protection, main content with Readability over linkedom, to markdown.
// For a `link` attachment, `attachment.path` carries the address (the table has no other column).
import { Agent, fetch } from 'undici';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { ExtractError } from './errors.js';
import { resolveSafeHost } from './lib/ssrf.js';
import { createProgress } from './lib/progress.js';
import { annotate, withSpan } from '../telemetry/api.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);
const PLAIN_TYPES = new Set(['text/plain', 'text/markdown']);

function parseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ExtractError('link_invalid', 'La dirección del enlace no es válida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ExtractError('link_invalid', 'Sólo se admiten enlaces http y https.', { protocol: url.protocol });
  }
  if (url.username || url.password) {
    throw new ExtractError('link_invalid', 'El enlace no puede llevar usuario ni contraseña.');
  }
  return url;
}

/** A `lookup` that always returns the already validated addresses. */
function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  };
}

// Reads the stream up to `maxBytes`; if there is more, it cuts and reports it.
async function readCapped(response, maxBytes) {
  const chunks = [];
  let total = 0;
  let truncated = false;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > maxBytes) {
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  }
  return { bytes: Buffer.concat(chunks), truncated };
}

function decode(bytes, contentType) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 2048).toString('latin1'))?.[1];
  for (const label of [fromHeader, fromMeta, 'utf-8']) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // unknown encoding label: try the next one
    }
  }
  return bytes.toString('utf8');
}

async function download(startUrl, ctx) {
  const cfg = ctx.config.link;
  const lookup = ctx.deps?.lookup;
  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  const signal = ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout;
  let url = startUrl;
  try {
    for (let hop = 0; hop <= cfg.maxRedirects; hop++) {
      const addresses = await resolveSafeHost(url.hostname, { lookup, allowedPrivateHosts: cfg.allowedPrivateHosts });
      const agent = new Agent({ connect: { lookup: pinnedLookup(addresses) } });
      let response;
      try {
        response = await fetch(url, {
          dispatcher: agent,
          redirect: 'manual',
          signal,
          headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.8', 'accept-language': 'es,en;q=0.5' },
        });
        if (REDIRECT_STATUSES.has(response.status) && response.headers.get('location')) {
          await response.body?.cancel();
          url = parseUrl(new URL(response.headers.get('location'), url).href);
          continue;
        }
        if (response.status < 200 || response.status >= 300) {
          await response.body?.cancel();
          throw new ExtractError('link_http_error', `El enlace respondió con el código ${response.status}.`, { status: response.status });
        }
        const { bytes, truncated } = await readCapped(response, cfg.maxBytes);
        return {
          url,
          bytes,
          truncated,
          status: response.status,
          contentType: response.headers.get('content-type') ?? '',
          redirects: hop,
        };
      } finally {
        await agent.close();
      }
    }
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    if (ctx.signal?.aborted) throw new ExtractError('aborted', 'La extracción se canceló.');
    if (timeout.aborted) throw new ExtractError('link_timeout', 'El sitio del enlace tardó demasiado en responder.', { timeoutMs: cfg.timeoutMs });
    throw new ExtractError('link_fetch_failed', 'No se pudo abrir el enlace.', { cause: String(error?.cause?.code ?? error?.message ?? error) });
  }
  throw new ExtractError('link_too_many_redirects', 'El enlace redirige demasiadas veces.', { max: cfg.maxRedirects });
}

function toMarkdown(html, url) {
  const { document } = parseHTML(html);
  // Readability resolves relative addresses against these two properties.
  Object.defineProperty(document, 'baseURI', { value: url.href });
  Object.defineProperty(document, 'documentURI', { value: url.href });
  const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
  const article = new Readability(document).parse();
  if (article?.content) {
    const body = turndown.turndown(article.content).trim();
    return { title: article.title?.trim() || '', markdown: body, readable: true };
  }
  // No recognizable main content: the whole body is converted, without scripts or styles.
  for (const el of document.querySelectorAll('script, style, noscript, template')) el.remove();
  const title = document.title?.trim() || '';
  return { title, markdown: turndown.turndown(document.body?.innerHTML ?? '').trim(), readable: false };
}

export async function extractLink(attachment, ctx) {
  const progress = createProgress(ctx.onProgress, 3);
  const startedAt = performance.now();
  const url = parseUrl(attachment.url ?? attachment.path);
  progress.report('Descarga del enlace');
  const got = await withSpan('extract.link_download', { 'team.step': 'extract.link_download', 'team.tool': 'undici', 'url.full': url.href }, async () => {
    const out = await download(url, ctx);
    annotate({
      'url.final': out.url.href,
      'http.response.status_code': out.status,
      'http.response.content_type': out.contentType,
      'team.redirects': out.redirects,
      'team.output_bytes': out.bytes.length,
      'team.truncated': out.truncated,
    });
    return out;
  });
  progress.advance('Enlace descargado');

  const type = got.contentType.split(';')[0].trim().toLowerCase();
  const warnings = [];
  if (got.truncated) {
    warnings.push({ code: 'link_truncated', message: 'La página supera el tamaño máximo y se leyó sólo el comienzo.' });
  }
  let title = '';
  let markdown;
  let readable = null;
  if (PLAIN_TYPES.has(type)) {
    markdown = decode(got.bytes, got.contentType).trim();
  } else if (HTML_TYPES.has(type) || type === '') {
    ({ title, markdown, readable } = withSpan(
      'extract.readability',
      { 'team.step': 'extract.readability', 'team.tool': 'readability', 'team.input_bytes': got.bytes.length },
      () => {
        const out = toMarkdown(decode(got.bytes, got.contentType), got.url);
        annotate({ 'team.output_chars': out.markdown.length, 'team.readable': out.readable });
        return out;
      },
    ));
  } else {
    throw new ExtractError('link_unsupported_type', 'El enlace no apunta a una página que se pueda leer.', { contentType: type });
  }
  progress.advance('Contenido principal leído');
  const text = [title ? `# ${title}` : '', markdown, `Fuente: ${got.url.href}`].filter(Boolean).join('\n\n');
  progress.advance('Enlace convertido');
  return {
    text,
    meta: {
      url: startUrl(attachment),
      finalUrl: got.url.href,
      status: got.status,
      contentType: type,
      bytes: got.bytes.length,
      truncated: got.truncated,
      redirects: got.redirects,
      title,
      readable,
      warnings,
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}

const startUrl = (attachment) => attachment.url ?? attachment.path;
