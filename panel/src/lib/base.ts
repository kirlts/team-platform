// Where the panel is mounted (H-3721). The server writes both values into index.html when it serves it
// (`<meta name="team-base-path">`, `<meta name="team-api-base">`); in development they come from Vite's environment.
// Without either, the panel lives at `/` and calls `/api`, as before.

function meta(name: string): string | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') || null
}

/** `team`, `/team` and `/team/` all mean `/team/`. */
export function normalizeBase(raw: string): string {
  const trimmed = raw.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}/` : '/'
}

/** The panel's base path, always with a trailing slash. */
export const BASE_PATH = normalizeBase(meta('team-base-path') ?? import.meta.env.VITE_BASE_PATH ?? '/')

/** What `BrowserRouter` receives: the base without its trailing slash (`''` at the root). */
export const ROUTER_BASENAME = BASE_PATH.replace(/\/$/, '')

/** Prefix of every API call, the event stream and the attachment links; never with a trailing slash. */
export const API_BASE = (meta('team-api-base') ?? import.meta.env.VITE_API_BASE ?? '/api').replace(/\/+$/, '')
