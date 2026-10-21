import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifySystem, classifyUser, decomposeSystem, decomposeUser, membersBlock } from './prompts.js'

// Both prompt sets (UD-018) carry the same blocks: the language only changes the words around them.
const SETS = [
  { language: 'es-419', member: 'Miembro', noOldWords: /Responsabilidades|Dominios/, assign: /leyendo el perfil que cada miembro escribió/, oldAssign: /responsabilidades y dominios/, enrich: /plantilla pida enriquecer el mensaje con información del proyecto/ },
  { language: 'en', member: 'Member', noOldWords: /Responsibilities|Domains/, assign: /reading the profile each member wrote/, oldAssign: /responsibilities and domains/, enrich: /template asks to enrich the message with information about the project/ },
]

// UD-023: the whole profile reaches the model verbatim, under the member's name, and the model assigns from it.
const PROFILE = `Hago el servidor y la API. Decido el esquema.${'\n\n'}No toco la interfaz. ${'x'.repeat(3000)} fin del perfil.`

// UD-024: the project description rides in the cached system block of both calls, after the catalog or the template.
const DESCRIPTION = '# Atlas\n\nStack: Node 24, SQLite.\n\n- `src/api/`: rutas\n- `src/domain/`: reglas'

for (const { language, member, noOldWords, assign, oldAssign, enrich } of SETS) {
  test(`${language}: the team block carries the full profile, uncut, under the name`, () => {
    const block = membersBlock([{ id: 7, name: 'Ana', profile: PROFILE }, { id: 8, name: 'Beto', profile: '' }], language)
    assert.ok(block.includes(`- ${member} 7: Ana\n${PROFILE}\n`))
    assert.ok(block.includes('fin del perfil.'))
    assert.ok(block.includes(`- ${member} 8: Beto`))
    assert.equal(noOldWords.test(block), false)
  })

  test(`${language}: the decomposition call carries the verbatim profile and the instruction to assign from the profiles`, () => {
    const user = decomposeUser({ members: [{ id: 7, name: 'Ana', profile: PROFILE }], attachments: [], units: [{ id: 1, text: 'hola', source: { type: 'text' } }], language })
    assert.ok(user.includes(PROFILE))
    const system = decomposeSystem({ name: 't', description: '', fields: [], body: '' }, undefined, language).flat().join('\n')
    assert.match(system, assign)
    assert.equal(oldAssign.test(system), false)
  })

  test(`${language}: the project description goes verbatim in the system of both calls, after the catalog and the template`, () => {
    const project = { name: 'Atlas', description: DESCRIPTION }
    const classify = classifySystem({ areas: [{ id: 1, title: 'Error', description: 'd', position: 0 }], templates: [], project, language })
    const decompose = decomposeSystem({ name: 't', description: '', fields: [], body: 'cuerpo' }, project, language)
    for (const blocks of [classify, decompose]) {
      const text = blocks.join('\n')
      assert.ok(text.includes(DESCRIPTION))
      assert.match(text, enrich)
      assert.ok(blocks.at(-1).includes(DESCRIPTION)) // last block: the prefix before it does not change
    }
    assert.ok(classify.join('\n').indexOf('Error') < classify.join('\n').indexOf(DESCRIPTION))
    assert.ok(decompose.join('\n').indexOf('cuerpo') < decompose.join('\n').indexOf(DESCRIPTION))
  })

  test(`${language}: without a description no block is added`, () => {
    assert.equal(classifySystem({ areas: [], templates: [], project: { name: 'Atlas', description: '  ' }, language }).length, 2)
    assert.equal(decomposeSystem({ name: 't', description: '', fields: [], body: '' }, undefined, language).length, 2)
  })
}

// UD-025: the author's unpublished recent inputs ride in the user message of both calls, never in the cached system prompt.
const RECENT = [
  { id: 41, created_at: Date.UTC(2026, 9, 21, 14, 5), text_excerpt: 'El botón Exportar no hace nada en Safari.', proposed_titles: ['Corregir el botón Exportar', 'Revisar el menú de acciones'] },
  { id: 40, created_at: '2026-10-21T13:40:00Z', text_excerpt: 'Idea: avisar por WhatsApp.', proposed_titles: [] },
]
const UNITS = [{ id: 1, text: 'hola', source: { type: 'text' } }]

for (const { language, member } of SETS) {
  test(`${language}: the recent inputs block lists each input by its time, with its proposed titles and the instruction not to drop a repeated point`, () => {
    const user = decomposeUser({ members: [{ id: 7, name: 'Ana', profile: 'x' }], attachments: [], units: UNITS, language, recent: RECENT })
    assert.match(user, language === 'en' ? /Recent inputs from the same person, not yet published/ : /Envíos recientes de la misma persona, todavía sin publicar/)
    assert.ok(user.includes('2026-10-21 14:05') && user.includes('2026-10-21 13:40'))
    assert.ok(user.includes('Corregir el botón Exportar; Revisar el menú de acciones'))
    assert.match(user, language === 'en' ? /Never drop it silently/ : /Nunca lo omitas en silencio/)
    assert.ok(user.indexOf(`- ${member} 7`) < user.indexOf('2026-10-21 14:05'), 'after the members block')
    assert.ok(classifyUserText(language).includes('2026-10-21 14:05'))
    const system = [...classifySystem({ areas: [], templates: [], language }), ...decomposeSystem({ name: 't', description: '', fields: [], body: '' }, undefined, language)].join('\n')
    assert.equal(system.includes('2026-10-21 14:05'), false, 'not in the cached prefix')
  })

  test(`${language}: without recent inputs (absent or empty) there is no block`, () => {
    for (const recent of [undefined, []]) {
      const user = decomposeUser({ members: [], attachments: [], units: UNITS, language, recent })
      assert.equal(/Envíos recientes|Recent inputs/.test(user), false)
      assert.equal(/Envíos recientes|Recent inputs/.test(classifyUser({ units: UNITS, attachments: [], language, recent })), false)
    }
  })
}

function classifyUserText(language) {
  return classifyUser({ units: UNITS, attachments: [], language, recent: RECENT })
}
