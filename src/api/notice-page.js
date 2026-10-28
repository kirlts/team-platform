// A small server-rendered page for the places where a browser must read a reason and cannot be sent to the panel:
// the host's entry address is this very installation (no redirect, so no loop) and a rejected sign-in answer.
// It wears the panel's skin: the compiled stylesheet of the panel (sky, glass, Source Sans 3, wordmark, gel button), the host's
// THEME_CSS after it, and light or dark by the saved choice or the system (`notice-theme.js`, served by the API module).
// Voice of instrument (panel/DISENO.md): short noun title, one line of cause, one exit, no final period, no second person.
import { readFileSync } from 'node:fs'
import path from 'node:path'

const TEXTS = {
  es: {
    noAccess: 'Sin acceso',
    noAccessLine: 'La entrada a esta instalación es por el sitio del equipo',
    toSite: 'Ir al sitio del equipo',
    retry: 'Reintentar',
    ssoTitle: 'Inicio de sesión rechazado',
    ssoInvalid: 'La respuesta del sitio del equipo no es válida o ya se usó',
    unverifiedTitle: 'Correo sin verificar',
    ssoUnverified: 'El sitio del equipo no verificó el correo y lo corrige quien lo administra'
  },
  en: {
    noAccess: 'No access',
    noAccessLine: 'This installation is entered through the team site',
    toSite: 'Go to the team site',
    retry: 'Retry',
    ssoTitle: 'Sign-in rejected',
    ssoInvalid: 'The response of the team site is not valid or was already used',
    unverifiedTitle: 'Email not verified',
    ssoUnverified: 'The team site did not verify the email and whoever administers it fixes it'
  }
}

/** Reads the browser's theme choice (the panel's own key) or the system's, before the page paints. */
export const THEME_SCRIPT = `try{var p=localStorage.getItem('team-theme');var d=p==='dark'||((p!=='light')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}\n`

/** `en` when the browser prefers English, `es` otherwise (the default language of the product). */
export function pickLanguage (request) {
  const first = String(request.headers['accept-language'] ?? '').split(',')[0].trim().toLowerCase()
  return first.startsWith('en') ? 'en' : 'es'
}

/** True for a browser navigation: it asks for HTML before JSON. A client that asks for JSON or accepts anything keeps the JSON answer. */
export function wantsHtml (request) {
  const accept = String(request.headers.accept ?? '')
  const html = accept.indexOf('text/html')
  if (html === -1) return false
  const json = accept.indexOf('application/json')
  return json === -1 || html < json
}

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** The stylesheet of the compiled panel, found in its index.html; empty when there is no build (the page then has no skin, only structure). */
function panelStylesheet (config) {
  try {
    const html = readFileSync(path.join(config.panelDist, 'index.html'), 'utf8')
    const href = /<link[^>]+rel="stylesheet"[^>]+href="\.?\/?assets\/([^"]+\.css)"/.exec(html)
    return href ? `${config.basePath}assets/${href[1]}` : ''
  } catch { return '' }
}

const BUTTON = 'btn btn-gel h-12 px-6 gap-2 text-sm justify-center hit'
const WORDMARK = '<span class="wordmark flex min-w-0 items-center leading-tight text-fg gap-3 text-lg"><span aria-hidden="true" class="wordmark-logo shrink-0 wordmark-logo-large"></span>' +
  '<span aria-hidden="true" class="wordmark-orb orb shrink-0 rounded-full [--orb-bottom:var(--color-gel-bottom)] [--orb-top:var(--color-gel-top)] h-7 w-7"></span><span class="min-w-0 break-words">Team</span></span>'

function page (config, lang, title, lines, action) {
  const css = panelStylesheet(config)
  const links = (css ? `<link rel="stylesheet" href="${escapeHtml(css)}">` : '') + (config.themeCss ? `<link rel="stylesheet" href="${escapeHtml(config.basePath)}theme.css">` : '')
  const button = action ? `<a class="${BUTTON}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>` : ''
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title>` +
    `<script src="${escapeHtml(config.basePath)}notice-theme.js"></script>${links}</head>` +
    '<body><main data-screen="notice" role="alert" class="relative flex min-h-dvh items-center justify-center px-5"><div class="relative z-10 w-full max-w-sm">' +
    `<section class="glass-strong leaf relative flex w-full flex-col gap-6 p-7"><div>${WORDMARK}</div><div class="flex flex-col gap-2"><h1>${escapeHtml(title)}</h1>` +
    `${lines.map((l) => `<p style="text-wrap:pretty">${escapeHtml(l)}</p>`).join('')}</div>${button}</section></div></main></body></html>`
}

/** `next` of the request when it is a path of this site; the base path otherwise. */
function nextPath (request, config) {
  const next = request.query?.next
  return typeof next === 'string' && /^\/(?![/\\])[^\r\n]*$/.test(next) ? next : config.basePath
}

/**
 * The host's entry is this installation and the mode has no entry of its own. The exit is the host's site when `HOST_SITE_URL` is
 * declared, and «Reintentar» (the destination asked for, which asks again) otherwise.
 */
export function noAccessPage (config, request) {
  const lang = pickLanguage(request)
  const t = TEXTS[lang]
  const site = config.identity.hostSiteUrl
  const action = site ? { href: site, label: t.toSite } : { href: nextPath(request, config), label: t.retry }
  return page(config, lang, t.noAccess, [t.noAccessLine], action)
}

/** A rejected sign-in answer. A missing email verification is the host's to fix, so the page names who and offers no way back into the same error. */
export function ssoRejectedPage (config, request, code, startUrl) {
  const lang = pickLanguage(request)
  const t = TEXTS[lang]
  if (code === 'sso_unverified') return page(config, lang, t.unverifiedTitle, [t.ssoUnverified], null)
  return page(config, lang, t.ssoTitle, [t.ssoInvalid], { href: startUrl, label: t.retry })
}
