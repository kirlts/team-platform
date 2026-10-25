// The client against the real API of this repository: the application is built in process, listens on a port of the test
// range and answers over HTTP. What is checked is what an interface relies on: the session, the versions and the retry, the
// multipart forms, the deletions and their undo, the send in the name of another member and the error codes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isTeamApiError, type InputRecord, type TeamApiError, type TeamClient } from '../src/index.js'
import { publishedMessage, startServer, until, type TestServer } from './server.js'

let server: TestServer
let ed: TeamClient
let ana: TeamClient
let beto: TeamClient

const file = (name: string, content = 'contenido de prueba', type = 'text/plain') => new File([content], name, { type })
const failure = async (p: Promise<unknown>): Promise<TeamApiError> => {
  try {
    await p
  } catch (err) {
    if (isTeamApiError(err)) return err
    throw err
  }
  throw new Error('expected the call to fail')
}

beforeAll(async () => {
  server = await startServer()
  ed = await server.as('ed@x.org')
  ana = await server.as('ana@x.org')
  beto = await server.as('beto@x.org')
})
afterAll(async () => {
  await server.close()
})

describe('session and errors', () => {
  it('without a session the API answers 401 with its code, as a TeamApiError', async () => {
    const err = await failure(server.anonymous().me.get())
    expect(err).toMatchObject({ status: 401, code: 'unauthenticated' })
    expect(err.message).not.toBe('')
  })

  it('a wrong password is refused and a right one opens the session; logout closes it', async () => {
    const team = server.anonymous()
    const member = await ed.members.create({ email: 'sesion@x.org', name: 'Sesión', password: 'una clave larga de prueba 1' })
    const err = await failure(team.auth.login({ email: 'sesion@x.org', password: 'no es la clave de nadie' }))
    expect(err.status).toBe(401)
    // The server makes a failed attempt wait before the next one (about a second); the client reports it as 429 too_many_requests.
    await until(async () => {
      try {
        await team.auth.login({ email: 'sesion@x.org', password: 'una clave larga de prueba 1' })
        return true
      } catch (e) {
        if (isTeamApiError(e) && e.code === 'too_many_requests') return false
        throw e
      }
    })
    expect((await team.me.get()).email).toBe('sesion@x.org')
    await team.auth.logout()
    expect((await failure(team.me.get())).status).toBe(401)
    await ed.members.delete({ id: member.id, purge: true })
  })

  it('a missing thing is 404 not_found and a role refusal is 403', async () => {
    expect(await failure(ana.messages.get('999999'))).toMatchObject({ status: 404, code: 'not_found' })
    expect((await failure(ana.jobs.trace('1'))).status).toBe(403)
  })

  it('the code is one the generated list knows', async () => {
    const { REQUEST_ERROR_CODES } = await import('../src/index.js')
    const err = await failure(ana.messages.get('999999'))
    expect(REQUEST_ERROR_CODES).toContain(err.code)
  })

  it('the contract and the health are readable without a session', async () => {
    const team = server.anonymous()
    expect((await team.openapi()).openapi).toBe('3.1.0')
    expect(await team.health()).toMatchObject({ status: expect.any(String) })
  })
})

describe('reads', () => {
  it('areas come sorted with their templates, members as a list, and the project and settings answer', async () => {
    const areas = await ana.areas.list()
    expect(areas.length).toBeGreaterThan(1)
    expect(areas.map((a) => a.position)).toEqual([...areas.map((a) => a.position)].sort((a, b) => a - b))
    const templates = await ed.templates.list(areas[0].id)
    expect(Array.isArray(templates)).toBe(true)
    expect((await ana.members.list()).map((m) => m.email)).toContain('ed@x.org')
    expect((await ana.project.get()).name).toBeTruthy()
    expect((await ed.providers.list()).length).toBeGreaterThan(0)
    expect((await failure(ana.providers.list())).status).toBe(403)
    expect((await ed.connections.list()).presets.length).toBeGreaterThan(0)
    expect(typeof (await ed.publication.get()).auto_publish).toBe('boolean')
    expect((await ed.analysis.get()).framing).toBeTruthy()
  })
})

describe('sends, multipart and «enviar como»', () => {
  it('a send with a file and a link goes as multipart, is analyzed and published, and its file is served', async () => {
    const { input_id } = await ana.inputs.create({ text: 'con adjuntos', files: [file('nota.txt')], links: ['https://example.org/a'] })
    const input = (await until(async () => {
      const v = await ana.inputs.get(input_id)
      return v.status === 'published' ? v : null
    })) as InputRecord
    expect(input.attachments.map((a) => a.kind).sort()).toEqual(['document', 'link'])
    const doc = input.attachments.find((a) => a.kind === 'document')!
    const res = await ana.raw(ana.attachmentUrl(doc.id))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('contenido de prueba')
    expect((await ana.inputs.history()).some((i) => i.id === input_id)).toBe(true)
  })

  it('«enviar como»: the Editor sends in the name of a member; the message is theirs and records who sent it', async () => {
    const { input_id } = await ed.inputs.create({ text: 'en nombre de Ana', files: [], links: [], asMemberId: server.ids.ana })
    const input = (await until(async () => {
      const v = await ana.inputs.get(input_id)
      return v.status === 'published' ? v : null
    })) as InputRecord
    const message = await ana.messages.get(String(input.message_ids?.[0] ?? input.messages?.[0]?.id))
    expect(message.author_id).toBe(server.ids.ana)
    expect(message.sent_by_id).toBe(server.ids.ed)
  })

  it('«enviar como» to somebody who is not an active member is 400 send_as_invalid', async () => {
    const err = await failure(beto.inputs.create({ text: 'a nadie', files: [], links: [], asMemberId: '99999' }))
    expect(err).toMatchObject({ status: 400, code: 'send_as_invalid' })
  })

  it('recipients: the send is assigned to the recipient and a non-member id is 400 recipient_invalid', async () => {
    const { input_id } = await ana.inputs.create({ text: 'para Beto', files: [], links: [], recipientIds: [server.ids.ed] })
    const input = (await until(async () => {
      const v = await ana.inputs.get(input_id)
      return v.status === 'published' ? v : null
    })) as InputRecord
    expect(input.recipient_ids).toEqual([server.ids.ed])
    const message = await ana.messages.get(String(input.message_ids?.[0] ?? input.messages?.[0]?.id))
    expect(message.assignee_ids).toEqual([server.ids.ed])
    const err = await failure(ana.inputs.create({ text: 'a nadie', files: [], links: [], recipientIds: ['99999'] }))
    expect(err).toMatchObject({ status: 400, code: 'recipient_invalid' })
  })

  it('reprocess of a published send is the Editor\'s: the member gets 403 and the Editor sets the messages aside', async () => {
    const { input_id } = await ana.inputs.create({ text: 'para reprocesar', files: [], links: [] })
    await until(async () => (await ana.inputs.get(input_id)).status === 'published')
    expect((await failure(ana.inputs.reprocess(input_id))).status).toBe(403)
    const result = await ed.inputs.reprocess(input_id)
    expect(result.input_id).toBe(input_id)
    expect(result.set_aside?.messages).toBeGreaterThan(0)
  })

  it('the queue lists the sends of everybody to the Editor only', async () => {
    const page = await ed.inputs.queue(1, 50)
    expect(page.total).toBeGreaterThan(0)
    expect((await failure(ana.inputs.queue(1, 50))).status).toBe(403)
  })
})

describe('edit with version', () => {
  it('sends the version of the cache and, if another edit got in first, reads again and sends once more (edit_conflict)', async () => {
    const id = await publishedMessage(ana, 'para editar')
    const stale = await ana.messages.get(id)
    const bumped = await ana.messages.patch(id, { title: 'primera edición' })
    expect(bumped.version).toBe((stale.version ?? 0) + 1)

    const patches: (number | undefined)[] = []
    const watching = await server.as('ana@x.org', {
      instrument: (method) => (method === 'PATCH' ? () => void patches.push(undefined) : () => undefined),
    })
    let remembered: number | undefined
    const saved = await watching.messages.patch(id, { body: 'segunda edición' }, { cached: () => stale, remember: (fresh) => void (remembered = fresh.version) })
    expect(patches).toHaveLength(2) // the stale version was refused, the current one went through
    expect(remembered).toBe(bumped.version)
    expect(saved.version).toBe((bumped.version ?? 0) + 1)
    expect(saved.title).toBe('primera edición')
    expect(saved.body).toBe('segunda edición')
  })

  it('with the current version in the cache it is one request; without a cache it reads the version first', async () => {
    const id = await publishedMessage(ana, 'otra para editar')
    const current = await ana.messages.get(id)
    const saved = await ana.messages.patch(id, { title: 'directa' }, { cached: () => current })
    expect(saved.version).toBe((current.version ?? 0) + 1)
    expect((await ana.messages.patch(id, { title: 'sin caché' })).title).toBe('sin caché')
  })

  it('a refused edit is not retried: somebody else\'s message is 403 not_message_author', async () => {
    const id = await publishedMessage(ana, 'ajena')
    expect(await failure(beto.messages.patch(id, { title: 'mía' }))).toMatchObject({ status: 403 })
  })

  it('files and links added to a message count as an edit with the version, and retry on conflict', async () => {
    const id = await publishedMessage(ana, 'con más adjuntos')
    const stale = await ana.messages.get(id)
    await ana.messages.patch(id, { title: 'cambia la versión' })
    const saved = await ana.messages.addAttachments(id, { files: [file('extra.txt', 'más')], links: ['https://example.org/b'] }, { cached: () => stale })
    expect(saved.attachments.length).toBe(stale.attachments.length + 2)
  })

  it('a reply edit uses the version of the reply in the thread and retries on conflict', async () => {
    const id = await publishedMessage(ana, 'con respuesta')
    await beto.replies.create(id, { body: 'primera', kind: 'answer' })
    const thread = await beto.messages.get(id)
    const reply = thread.replies[0]
    await beto.replies.edit(id, reply.id, 'editada una vez')
    const saved = await beto.replies.edit(id, reply.id, 'editada otra vez', { cached: () => thread })
    expect(saved.replies[0].body).toBe('editada otra vez')
    expect(saved.replies[0].version).toBeGreaterThan(reply.version ?? 0)
  })
})

describe('replies', () => {
  it('a reply goes as JSON, or as multipart with files and links, and the author cannot answer their own message', async () => {
    const id = await publishedMessage(ana, 'para responder')
    await beto.replies.create(id, { body: 'solo texto', kind: 'answer' })
    await beto.replies.create(id, { body: 'con archivo', kind: 'fix', files: [file('evidencia.txt')], links: ['https://example.org/c'] })
    const thread = await ana.messages.get(id)
    expect(thread.replies.map((r) => r.body)).toEqual(['solo texto', 'con archivo'])
    expect(thread.replies[1].attachments?.length).toBe(2)
    expect((await failure(ana.replies.create(id, { body: 'propia', kind: 'answer' }))).status).toBeGreaterThanOrEqual(400)
  })
})

describe('deletions and their undo', () => {
  it('a message is deleted with confirm and comes back with restore, alone and in batch', async () => {
    const one = await publishedMessage(ana, 'borrar uno')
    const two = await publishedMessage(ana, 'borrar dos')
    await ana.messages.delete(one)
    expect(await failure(ana.messages.get(one))).toMatchObject({ status: 404 })
    expect((await ana.messages.restore(one)).id).toBe(one)
    expect((await ana.messages.get(one)).id).toBe(one)

    expect((await ana.messages.deleteMany([one, two])).ids.sort()).toEqual([one, two].sort())
    expect((await failure(ana.messages.get(two))).status).toBe(404)
    expect((await ana.messages.restoreMany([one, two])).ids.sort()).toEqual([one, two].sort())
    expect((await ana.messages.get(two)).id).toBe(two)
  })

  it('a batch of somebody else\'s messages is refused whole', async () => {
    const id = await publishedMessage(ana, 'de Ana')
    expect((await failure(beto.messages.deleteMany([id]))).status).toBe(403)
    expect((await ana.messages.get(id)).id).toBe(id)
  })

  it('a reply is deleted and restored, and the thread comes back each time', async () => {
    const id = await publishedMessage(ana, 'hilo')
    await beto.replies.create(id, { body: 'una', kind: 'answer' })
    const replyId = (await beto.messages.get(id)).replies[0].id
    expect((await beto.replies.delete(id, replyId)).replies).toHaveLength(0)
    expect((await beto.replies.restore(replyId)).replies).toHaveLength(1)
  })

  it('areas and templates: delete, list among the deleted, restore; one by one and in batch', async () => {
    const a = (await ed.areas.save({ title: 'Efímera A', description: 'x', color: '#336699' })) as { id: string }
    const b = (await ed.areas.save({ title: 'Efímera B', description: 'x', color: '#663399' })) as { id: string }
    await ed.areas.delete(a.id)
    expect((await ed.areas.list()).some((x) => x.id === a.id)).toBe(false)
    expect((await ed.areas.listDeleted()).some((x) => x.id === a.id)).toBe(true)
    expect((await ed.areas.restore(a.id)).id).toBe(a.id)
    await ed.areas.deleteMany([a.id, b.id])
    expect((await ed.areas.list()).some((x) => x.id === a.id || x.id === b.id)).toBe(false)
    await ed.areas.restoreMany([a.id, b.id])
    expect((await ed.areas.list()).filter((x) => x.id === a.id || x.id === b.id)).toHaveLength(2)

    const t = (await ed.templates.save(a.id, { name: 'Plantilla', description: 'd', body_markdown: '---\nname: Plantilla\n---\nCuerpo\n' })) as { id: string }
    await ed.templates.delete(a.id, t.id)
    expect((await ed.templates.listDeleted(a.id)).map((x) => x.id)).toEqual([t.id])
    expect((await ed.templates.restore(t.id)).id).toBe(t.id)
    await ed.templates.deleteMany(a.id, [t.id])
    await ed.templates.restoreMany([t.id])
    expect((await ed.templates.list(a.id)).map((x) => x.id)).toEqual([t.id])
  })

  it('closing and reopening a message', async () => {
    const id = await publishedMessage(ana, 'cerrar')
    await ana.messages.setClosed({ id, closed: true })
    expect((await ana.messages.get(id)).status).toBe('closed')
    await ana.messages.setClosed({ id, closed: false })
    expect((await ana.messages.get(id)).status).not.toBe('closed')
  })
})

describe('settings and team', () => {
  it('the project description is saved as text or as a .md file (multipart), and the name is saved apart', async () => {
    await ed.project.save({ description: 'Descripción por texto' })
    expect((await ed.project.get()).description).toBe('Descripción por texto')
    await ed.project.save({ file: file('proyecto.md', '# Del archivo', 'text/markdown') })
    expect((await ed.project.get()).description).toContain('Del archivo')
    expect((await ed.project.saveName('Proyecto de prueba')).name).toBe('Proyecto de prueba')
  })

  it('publication, the framing of the analysis and the interface telemetry switch', async () => {
    expect((await ed.publication.save(false)).auto_publish).toBe(false)
    expect((await ed.publication.save(true)).auto_publish).toBe(true)
    const saved = await ed.analysis.saveFraming({ en: 'Framing of the test' })
    expect(saved.framing.en.value).toBe('Framing of the test')
    await ed.telemetry.setUiEnabled(true)
    expect((await ed.me.get()).ui_telemetry?.enabled).toBe(true)
    expect(await ed.telemetry.uiSummary()).toHaveProperty('days')
    await ed.telemetry.setUiEnabled(false)
  })

  it('members: the Editor adds, edits and removes; each one edits their own language', async () => {
    const created = await ed.members.create({ email: 'nuevo@x.org', name: 'Nuevo', password: 'otra clave larga de prueba 2' })
    expect(created.email).toBe('nuevo@x.org')
    expect((await ed.members.save({ id: created.id, self: false, patch: { name: 'Nombre nuevo' } })).name).toBe('Nombre nuevo')
    expect((await ana.members.saveLanguage('en')).language).toBe('en')
    await ana.members.saveLanguage('es-419')
    await ed.members.setPassword({ id: created.id, password: 'tercera clave larga de prueba 3' })
    expect(await ed.members.delete({ id: created.id })).toMatchObject({ member_id: created.id })
  })

  it('deleting a member with history is refused with 409 member_has_history and its details; purge takes the history too', async () => {
    const created = await ed.members.create({ email: 'historia@x.org', name: 'Historia', password: 'una clave larga de prueba 1' })
    const own = await server.as('historia@x.org')
    await publishedMessage(own, 'deja historial')
    const err = await failure(ed.members.delete({ id: created.id }))
    expect(err).toMatchObject({ status: 409, code: 'member_has_history' })
    const purged = await ed.members.delete({ id: created.id, purge: true })
    expect(purged.deleted.inputs).toBeGreaterThan(0)
  })

  it('jobs, audit and the trace are for the Editor', async () => {
    expect((await ed.jobs.list('done')).total).toBeGreaterThan(0)
    expect((await ed.audit.list(1, 5)).items.length).toBeGreaterThan(0)
    expect((await failure(ana.audit.list(1, 5))).status).toBe(403)
  })
})

describe('the upload with progress', () => {
  it('reports the fraction, sends the marker and resolves with the created input; an error body becomes a TeamApiError', async () => {
    class FakeXhr {
      static last: FakeXhr
      headers: Record<string, string> = {}
      upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      onabort: (() => void) | null = null
      status = 202
      responseText = ''
      withCredentials = false
      method = ''
      url = ''
      sent: FormData | null = null
      constructor() {
        FakeXhr.last = this
      }
      open(method: string, url: string) {
        this.method = method
        this.url = url
      }
      setRequestHeader(name: string, value: string) {
        this.headers[name] = value
      }
      send(form: FormData) {
        this.sent = form
      }
      abort() {
        this.onabort?.()
      }
    }
    const team = (await import('../src/index.js')).createTeamClient({ baseUrl: 'https://t.example.org', requestMarker: 'panel', credentials: 'include', xhr: () => new FakeXhr() as unknown as XMLHttpRequest })
    const fractions: number[] = []
    const ok = team.inputs.upload({ text: 'hola', files: [file('a.txt')], links: [] }, (f) => fractions.push(f))
    const x = FakeXhr.last
    x.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 })
    x.responseText = JSON.stringify({ input_id: '5', job_id: '9' })
    x.onload?.()
    expect(await ok).toEqual({ input_id: '5', job_id: '9' })
    expect(fractions).toEqual([0.25])
    expect([x.method, x.url, x.withCredentials]).toEqual(['POST', 'https://t.example.org/api/inputs', true])
    expect(x.headers).toMatchObject({ 'X-Team-Request': 'panel', Accept: 'application/json' })
    expect(x.sent?.get('text')).toBe('hola')

    const bad = team.inputs.upload({ text: '', files: [], links: [] }, () => undefined)
    FakeXhr.last.status = 400
    FakeXhr.last.responseText = JSON.stringify({ code: 'input_empty', message: 'vacío' })
    FakeXhr.last.onload?.()
    expect(await failure(bad)).toMatchObject({ status: 400, code: 'input_empty', message: 'vacío' })

    const down = team.inputs.upload({ text: 'x', files: [], links: [] }, () => undefined)
    FakeXhr.last.onerror?.()
    expect(await failure(down)).toMatchObject({ status: 0, code: 'network' })

    const controller = new AbortController()
    const cancelled = team.inputs.upload({ text: 'x', files: [], links: [] }, () => undefined, controller.signal)
    controller.abort()
    expect(await failure(cancelled)).toMatchObject({ status: 0, code: 'cancelled' })
  })
})

describe('the event stream', () => {
  it('opens the address of the client with its factory and feeds the store', async () => {
    const { EventsStore } = await import('../src/index.js')
    const urls: string[] = []
    const listeners = new Map<string, (e: MessageEvent) => void>()
    const source = {
      readyState: 1,
      close() {},
      addEventListener: (type: string, fn: (e: MessageEvent) => void) => void listeners.set(type, fn),
      onopen: null as (() => void) | null,
      onerror: null,
      onmessage: null,
    }
    const store = new EventsStore()
    const close = ana.events.connect(store, { factory: (u) => (urls.push(u), source as never) })
    expect(urls).toEqual([`${server.baseUrl}/api/events`])
    listeners.get('progress')?.({ data: JSON.stringify({ job_id: 'j1', percent: 40, phrase: 'Leyendo' }) } as MessageEvent)
    listeners.get('message')?.({ data: JSON.stringify({ message_id: 'm1', title: 'Nuevo', author_id: 'u1' }) } as MessageEvent)
    expect(store.getSnapshot().progress.j1.percent).toBe(40)
    expect(store.getSnapshot().unread).toBe(1)
    close()
  })
})
