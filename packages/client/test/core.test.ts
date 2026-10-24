// The parts of the client that need no server: keys, invalidations, version-and-retry, forms, errors, transport and undo.
import { describe, expect, it, vi } from 'vitest'
import {
  attachmentsForm,
  CLIENT_ERROR_CODES,
  createTeamClient,
  createTransport,
  errorFromResponse,
  INVALIDATE,
  invalidate,
  inputForm,
  isEditConflict,
  kindFromMime,
  normalizePrefix,
  queryKeys,
  replyForm,
  replyHasMedia,
  sendVersioned,
  TeamApiError,
  unwrapList,
  deletion,
  edit,
  createUndoCore,
  messagesQueryString,
} from '../src/index.js'

describe('cache keys', () => {
  it('keep the shape every invalidation by root depends on', () => {
    expect(queryKeys.me()).toEqual(['me'])
    expect(queryKeys.areas()).toEqual(['areas'])
    expect(queryKeys.deletedAreas().slice(0, 1)).toEqual(['areas'])
    expect(queryKeys.templates('a1')).toEqual(['templates', 'a1'])
    expect(queryKeys.deletedTemplates('a1').slice(0, 2)).toEqual(['templates', 'a1'])
    expect(queryKeys.messages('status=open', 'u1')).toEqual(['messages', 'status=open', 'u1'])
    expect(queryKeys.summary().slice(0, 1)).toEqual(['messages'])
    expect(queryKeys.message('m1')).toEqual(['message', 'm1'])
    expect(queryKeys.input('i1')).toEqual(['inputs', 'i1'])
    expect(queryKeys.tray().slice(0, 1)).toEqual(['inputs'])
    expect(queryKeys.history().slice(0, 1)).toEqual(['inputs'])
    expect(queryKeys.queue(2, 20)).toEqual(['inputs', 'queue', 2, 20])
    expect(queryKeys.models('x')).toEqual(['models', 'x'])
    expect(queryKeys.jobTrace('j1')).toEqual(['jobs', 'trace', 'j1'])
  })
})

describe('invalidations', () => {
  it('invalidate the roots of the named operation, in order, and wait for all of them', async () => {
    const seen: unknown[][] = []
    const qc = { invalidateQueries: vi.fn(async ({ queryKey }: { queryKey: readonly unknown[] }) => void seen.push([...queryKey])) }
    await invalidate(qc, 'deleteArea')
    expect(seen).toEqual([['areas'], ['templates'], ['messages'], ['message']])
    await invalidate(qc, 'publish')
    expect(seen.slice(4)).toEqual([['messages'], ['areas'], ['inputs']])
  })

  it('every change that touches a message refreshes the lists and the counts of the areas', () => {
    for (const name of ['reply', 'patchMessage', 'setClosed', 'deleteMessage', 'restoreMessage', 'deleteReply', 'restoreReply'] as const) {
      expect(INVALIDATE[name]).toContain('messages')
    }
    for (const name of ['reply', 'patchMessage', 'setClosed', 'deleteMessage', 'restoreMessage', 'publish', 'deleteArea'] as const) {
      expect(INVALIDATE[name]).toContain('areas')
    }
  })
})

describe('sendVersioned', () => {
  const conflict = () => new TeamApiError(409, 'otra edición', 'edit_conflict')
  const base = (over: Partial<Parameters<typeof sendVersioned<{ version: number }, string>>[0]> = {}) => ({
    fetchCurrent: vi.fn(async () => ({ version: 7 })),
    versionOf: (d: { version: number } | undefined) => d?.version,
    send: vi.fn(async (version: number | undefined) => `sent ${version}`),
    ...over,
  })

  it('sends the version in the cache without reading the server', async () => {
    const o = base({ cached: () => ({ version: 3 }) })
    expect(await sendVersioned(o)).toBe('sent 3')
    expect(o.fetchCurrent).not.toHaveBeenCalled()
  })

  it('reads the current version when the cache has none', async () => {
    const o = base()
    expect(await sendVersioned(o)).toBe('sent 7')
    expect(o.fetchCurrent).toHaveBeenCalledTimes(1)
  })

  it('on edit_conflict reads again, remembers what it read and sends once more with that version', async () => {
    const remember = vi.fn()
    const send = vi.fn().mockRejectedValueOnce(conflict()).mockResolvedValueOnce('ok')
    const o = base({ cached: () => ({ version: 3 }), remember, send, fetchCurrent: vi.fn(async () => ({ version: 9 })) })
    expect(await sendVersioned(o)).toBe('ok')
    expect(send.mock.calls.map((c) => c[0])).toEqual([3, 9])
    expect(remember).toHaveBeenCalledWith({ version: 9 })
  })

  it('a second conflict and any other error go up', async () => {
    const send = vi.fn().mockRejectedValue(conflict())
    await expect(sendVersioned(base({ cached: () => ({ version: 1 }), send }))).rejects.toMatchObject({ code: 'edit_conflict' })
    expect(send).toHaveBeenCalledTimes(2)
    const other = vi.fn().mockRejectedValue(new TeamApiError(403, '', 'not_message_author'))
    await expect(sendVersioned(base({ cached: () => ({ version: 1 }), send: other }))).rejects.toMatchObject({ code: 'not_message_author' })
    expect(other).toHaveBeenCalledTimes(1)
  })

  it('a failure while reading the current version is not an edit conflict', async () => {
    const o = base({ fetchCurrent: vi.fn(async () => { throw new TeamApiError(404, '', 'not_found') }) })
    await expect(sendVersioned(o)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('errors', () => {
  it('maps { code, message, ...details } to a TeamApiError', async () => {
    const res = new Response(JSON.stringify({ code: 'provider_check_failed', message: 'falló', cause: 'invalid_key', duration_ms: 17 }), { status: 422 })
    const err = await errorFromResponse(res)
    expect(err).toBeInstanceOf(TeamApiError)
    expect(err).toMatchObject({ status: 422, code: 'provider_check_failed', message: 'falló', details: { cause: 'invalid_key', duration_ms: 17 } })
  })

  it('falls back to http_<status> when the body carries no code, and reads `error` as the message', async () => {
    expect(await errorFromResponse(new Response('', { status: 502 }))).toMatchObject({ code: 'http_502', message: '' })
    expect(await errorFromResponse(new Response(JSON.stringify({ error: 'caído' }), { status: 500 }))).toMatchObject({ code: 'http_500', message: 'caído', details: { error: 'caído' } })
  })

  it('recognizes an edit conflict by name, across copies of the package', () => {
    expect(isEditConflict(new TeamApiError(409, '', 'edit_conflict'))).toBe(true)
    expect(isEditConflict(new TeamApiError(409, '', 'conflict'))).toBe(false)
    expect(isEditConflict(new Error('x'))).toBe(false)
    const foreign = Object.assign(new Error('x'), { name: 'TeamApiError', code: 'edit_conflict' })
    expect(isEditConflict(foreign)).toBe(true)
  })
})

describe('transport', () => {
  const fake = (answer: () => Response | Promise<Response>) => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return answer()
    }) as unknown as typeof fetch
    return { calls, fetchFn }
  }

  it('composes baseUrl, apiPrefix and path, and normalizes the prefix', () => {
    expect(normalizePrefix('api/')).toBe('/api')
    expect(normalizePrefix('')).toBe('')
    expect(normalizePrefix('https://x.org/api/')).toBe('https://x.org/api')
    expect(createTransport({ baseUrl: 'https://team.example.org/', apiPrefix: '/team/api' }).url('/me')).toBe('https://team.example.org/team/api/me')
    expect(createTransport().url('/me')).toBe('/api/me')
  })

  it('sends the marker only on unsafe methods, JSON bodies with their type, and the extra headers', async () => {
    const { calls, fetchFn } = fake(() => new Response('{}', { status: 200 }))
    const team = createTeamClient({ fetch: fetchFn, requestMarker: 'panel', headers: () => ({ Authorization: 'Bearer t' }) })
    await team.me.get()
    await team.messages.close('m1')
    expect(calls[0].init.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer t' })
    expect(calls[1].init.headers).toMatchObject({ 'X-Team-Request': 'panel' })
    await team.areas.save({ title: 'A', color: '#000000' })
    expect(calls[2].init).toMatchObject({ method: 'POST', body: JSON.stringify({ title: 'A', description: undefined, color: '#000000' }) })
    expect((calls[2].init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('credentials follow COOKIE_MODE, and can be overridden', async () => {
    const { calls, fetchFn } = fake(() => new Response('{}'))
    await createTeamClient({ fetch: fetchFn }).me.get()
    await createTeamClient({ fetch: fetchFn, cookieMode: 'cross-origin' }).me.get()
    await createTeamClient({ fetch: fetchFn, credentials: 'include' }).me.get()
    expect(calls.map((c) => c.init.credentials)).toEqual(['same-origin', 'include', 'include'])
  })

  it('a failure before an answer is a TeamApiError with status 0 and code network; an abort passes through', async () => {
    const down = createTeamClient({ fetch: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch })
    await expect(down.me.get()).rejects.toMatchObject({ status: 0, code: CLIENT_ERROR_CODES.network })
    const abort = createTeamClient({ fetch: (async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }) as unknown as typeof fetch })
    await expect(abort.me.get()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('204 is undefined, and instrument sees the method, the relative path and the outcome', async () => {
    const seen: unknown[] = []
    const { fetchFn } = fake(() => new Response(null, { status: 204 }))
    const team = createTeamClient({
      fetch: fetchFn,
      instrument: (method, path) => (result) => void seen.push([method, path, result]),
    })
    expect(await team.messages.close('m1')).toBeUndefined()
    expect(seen).toEqual([['POST', '/messages/m1/close', { status: 204 }]])
  })

  it('builds the same paths and query strings as the panel always did', async () => {
    const { calls, fetchFn } = fake(() => new Response('{"items":[]}'))
    const team = createTeamClient({ fetch: fetchFn })
    await team.inputs.tray()
    await team.inputs.history()
    await team.inputs.queue(2, 20)
    await team.inputs.delete({ id: 'i1', withMessages: true })
    await team.members.delete({ id: 'u1', purge: true })
    await team.jobs.list('failed')
    await team.jobs.purge('done')
    await team.audit.list(1, 50, 'input.create')
    await team.areas.listDeleted()
    await team.templates.listDeleted('a1')
    await team.messages.deleteMany(['a', 'b'])
    expect(calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([
      'GET /api/inputs?mine=1&compact=1&status=queued,extracting,analyzing,proposed,failed',
      'GET /api/inputs?mine=1&order=desc&compact=1',
      'GET /api/inputs?all=1&page=2&limit=20',
      'DELETE /api/inputs/i1?confirm=true&with_messages=true',
      'DELETE /api/members/u1?confirm=true&purge=true',
      'GET /api/jobs?state=failed&limit=1',
      'DELETE /api/jobs?state=done&confirm=true',
      'GET /api/audit?page=1&limit=50&action=input.create',
      'GET /api/areas?include_deleted=true',
      'GET /api/areas/a1/templates?include_deleted=true',
      'POST /api/messages/delete?confirm=true',
    ])
  })

  it('addresses of files and streams use the configured base', () => {
    const team = createTeamClient({ baseUrl: 'https://team.example.org', apiPrefix: '/api' })
    expect(team.attachmentUrl('a 1')).toBe('https://team.example.org/api/attachments/a%201')
    expect(team.replyAttachmentUrl('r1')).toBe('https://team.example.org/api/replies/attachments/r1')
    expect(team.transcriptUrl('a1')).toBe('https://team.example.org/api/attachments/a1/transcript')
    expect(team.events.url).toBe('https://team.example.org/api/events')
  })
})

describe('multipart forms', () => {
  const file = (name: string, type = 'text/plain') => new File(['x'], name, { type })

  it('the input form carries text, files, links and as_member_id under the names the server reads', () => {
    const form = inputForm({ text: 'hola', files: [file('a.txt'), file('b.png', 'image/png')], links: ['https://x.org'], asMemberId: '3' })
    expect(form.get('text')).toBe('hola')
    expect(form.getAll('files').map((f) => (f as File).name)).toEqual(['a.txt', 'b.png'])
    expect(form.getAll('links')).toEqual(['https://x.org'])
    expect(form.get('as_member_id')).toBe('3')
    expect(inputForm({ text: '', files: [], links: [] }).has('as_member_id')).toBe(false)
  })

  it('a reply is multipart only with files or links', () => {
    expect(replyHasMedia({})).toBe(false)
    expect(replyHasMedia({ files: [] })).toBe(false)
    expect(replyHasMedia({ links: ['https://x.org'] })).toBe(true)
    const form = replyForm({ body: 'listo', kind: 'fix', files: [file('a.txt')], links: ['https://x.org'] })
    expect([form.get('body'), form.get('kind')]).toEqual(['listo', 'fix'])
    expect(form.getAll('files')).toHaveLength(1)
  })

  it('the attachments form carries the version that was read', () => {
    const form = attachmentsForm(4, [file('a.txt')], ['https://x.org'])
    expect(form.get('version')).toBe('4')
    expect(form.getAll('links')).toEqual(['https://x.org'])
  })

  it('kindFromMime falls back to the extension when the system declares no type', () => {
    expect(kindFromMime('image/png')).toBe('image')
    expect(kindFromMime('', 'nota.wav')).toBe('audio')
    expect(kindFromMime('application/octet-stream', 'v.MOV')).toBe('video')
    expect(kindFromMime('application/pdf', 'a.pdf')).toBe('document')
  })

  it('a message query string is the server filters plus the replies feed', () => {
    const query = { filters: [{ prop: 'status' as const, op: 'eq' as const, value: 'open' }, { prop: 'area' as const, op: 'neq' as const, value: 'a1' }], q: ' texto ' }
    expect(messagesQueryString(query)).toBe('status=open&q=texto')
    expect(messagesQueryString(query, true)).toBe('status=open&q=texto&replies=1')
  })

  it('unwrapList accepts an array, { items } or nothing', () => {
    expect(unwrapList([1])).toEqual([1])
    expect(unwrapList({ items: [2] })).toEqual([2])
    expect(unwrapList(undefined)).toEqual([])
  })
})

describe('undo helpers', () => {
  it('a deletion is undone by its restore and done again by its delete; an edit by writing the previous value', async () => {
    const log: string[] = []
    const core = createUndoCore()
    await core.run(deletion('borrar', () => log.push('delete'), () => log.push('restore')))
    await core.run(edit('título', (v: string) => log.push(`set ${v}`), 'a', 'b'))
    await core.undo()
    await core.undo()
    await core.redo()
    expect(log).toEqual(['delete', 'set b', 'set a', 'restore', 'delete'])
  })
})
