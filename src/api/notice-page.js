// A small server-rendered page for the two places where a browser must read a reason and cannot be sent to the panel:
// the host's entry address is this very installation (no redirect, so no loop), and a rejected sign-in answer.
// Voice of instrument (panel/DISENO.md): short noun title, one line, no final period, no second person.

const TEXTS = {
  es: {
    noAccess: 'Sin acceso',
    trustedHeader: 'Falta la cabecera del anfitrión o llega de una dirección no confiable',
    hostSession: 'Falta una sesión válida del anfitrión',
    ssoTitle: 'Inicio de sesión rechazado',
    ssoInvalid: 'La respuesta del anfitrión no es válida o ya se usó',
    ssoUnverified: 'El anfitrión no verificó el correo',
    entry: 'Ir a la entrada'
  },
  en: {
    noAccess: 'No access',
    trustedHeader: 'Host header missing or sent from an untrusted address',
    hostSession: 'A valid host session is missing',
    ssoTitle: 'Sign-in rejected',
    ssoInvalid: 'The host response is not valid or was already used',
    ssoUnverified: 'The host did not verify the email',
    entry: 'Go to sign-in'
  }
}

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

function page (lang, title, line, link) {
  const t = TEXTS[lang]
  const anchor = link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(t.entry)}</a></p>` : ''
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)}</title>` +
    '<style>body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;font:14px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText}' +
    'main{max-width:28rem;padding:1.25rem}h1{font-size:1.125rem;margin:0 0 .5rem}p{margin:.25rem 0}a{color:LinkText}</style></head>' +
    `<body><main role="alert"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(line)}</p>${anchor}</main></body></html>`
}

/** The host's entry is this installation and the mode has no entry of its own. */
export function noAccessPage (lang, { trustedHeader }) {
  const t = TEXTS[lang]
  return page(lang, t.noAccess, trustedHeader ? t.trustedHeader : t.hostSession, null)
}

/** A rejected sign-in answer: the reason in one line and a link to the entry. */
export function ssoRejectedPage (lang, code, message, entryUrl) {
  const t = TEXTS[lang]
  const line = lang === 'en' || !message ? (code === 'sso_unverified' ? t.ssoUnverified : t.ssoInvalid) : message.replace(/\.$/, '')
  return page(lang, t.ssoTitle, line, entryUrl)
}
