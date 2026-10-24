// What a write through the API leaves stale on every open screen. A `message` event with `reason: 'changed'` carries the cache
// roots to read again and, when the write was on one message, its id; the panel does not read it as a notice for the bell.
// It is published once the response was sent (the change is committed), to the whole team (`member_id` null), so a thread
// open in another tab or session shows a new reply, an edit, a state or a review without a reload and without polling.

const MESSAGES = ['messages', 'areas', 'inputs']

/** First segment of the route (without the API prefix) to the roots its writes make stale. */
const ROOTS = {
  messages: MESSAGES,
  replies: MESSAGES,
  inputs: ['inputs', 'messages', 'areas'],
  areas: ['areas', 'templates', 'messages'],
  templates: ['areas', 'templates', 'messages'],
  members: ['members', 'me', 'messages'],
  settings: ['me', 'project', 'providers', 'connections', 'analysis-settings', 'publication'],
  jobs: ['jobs', 'messages']
}

/** Writes that change nothing a screen shows, or that already have their own event (the progress of a job). */
const SILENT = [/^\/jobs\/:id\/(progress|marks)$/, /\/check$/, /^\/settings\/telemetry$/]

/**
 * The change event of a write, or null when the write leaves nothing stale. `routeUrl` is the route's template
 * (`/api/messages/:id/replies`), `params` its parameters.
 */
export function changeOfWrite ({ method, routeUrl, params = {}, status, prefix = '' }) {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || status >= 400) return null
  const path = prefix && routeUrl?.startsWith(prefix) ? routeUrl.slice(prefix.length) : routeUrl
  if (!path || SILENT.some((re) => re.test(path))) return null
  const segment = path.split('/')[1]
  const roots = ROOTS[segment]
  if (!roots) return null
  // Only the routes `/messages/:id…` name a message; `/replies/:id` names a reply and `/messages/delete` many.
  const messageId = segment === 'messages' && params.id !== undefined && /^\d+$/.test(String(params.id)) ? String(params.id) : undefined
  return { reason: 'changed', roots, ...(messageId ? { message_id: messageId } : {}) }
}
