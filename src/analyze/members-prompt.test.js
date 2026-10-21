import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifySystem, decomposeSystem, decomposeUser, membersBlock } from './prompts.js'

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
