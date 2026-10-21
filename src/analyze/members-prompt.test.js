import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifySystem, decomposeSystem, decomposeUser, membersBlock } from './prompts.js'

// UD-023: the whole profile reaches the model verbatim, under the member's name, and the model assigns from it.
const PROFILE = `Hago el servidor y la API. Decido el esquema.${'\n\n'}No toco la interfaz. ${'x'.repeat(3000)} fin del perfil.`

test('el bloque del equipo lleva el perfil completo y sin recortes bajo el nombre', () => {
  const block = membersBlock([{ id: 7, name: 'Ana', profile: PROFILE }, { id: 8, name: 'Beto', profile: '' }])
  assert.ok(block.includes(`- Miembro 7: Ana\n${PROFILE}\n`))
  assert.ok(block.includes('fin del perfil.'))
  assert.ok(block.includes('- Miembro 8: Beto'))
  assert.equal(/Responsabilidades|Dominios/.test(block), false)
})

test('la llamada de descomposición lleva el perfil textual y la instrucción de asignar desde los perfiles', () => {
  const user = decomposeUser({ members: [{ id: 7, name: 'Ana', profile: PROFILE }], attachments: [], units: [{ id: 1, text: 'hola', source: { type: 'text' } }] })
  assert.ok(user.includes(PROFILE))
  const system = decomposeSystem({ name: 't', description: '', fields: [], body: '' }).flat().join('\n')
  assert.match(system, /leyendo el perfil que cada miembro escribió/)
  assert.equal(/responsabilidades y dominios/.test(system), false)
})

// UD-024: the project description rides in the cached system block of both calls, after the catalog or the template.
const DESCRIPTION = '# Atlas\n\nStack: Node 24, SQLite.\n\n- `src/api/`: rutas\n- `src/domain/`: reglas'

test('la descripción del proyecto va textual en el sistema de ambas llamadas, después del catálogo y de la plantilla', () => {
  const project = { name: 'Atlas', description: DESCRIPTION }
  const classify = classifySystem({ areas: [{ id: 1, title: 'Error', description: 'd', position: 0 }], templates: [], project })
  const decompose = decomposeSystem({ name: 't', description: '', fields: [], body: 'cuerpo' }, project)
  for (const blocks of [classify, decompose]) {
    const text = blocks.join('\n')
    assert.ok(text.includes(DESCRIPTION))
    assert.match(text, /plantilla pida enriquecer el mensaje con información del proyecto/)
    assert.ok(blocks.at(-1).includes(DESCRIPTION)) // last block: the prefix before it does not change
  }
  assert.ok(classify.join('\n').indexOf('Error') < classify.join('\n').indexOf(DESCRIPTION))
  assert.ok(decompose.join('\n').indexOf('cuerpo') < decompose.join('\n').indexOf(DESCRIPTION))
})

test('sin descripción no se agrega ningún bloque', () => {
  assert.equal(classifySystem({ areas: [], templates: [], project: { name: 'Atlas', description: '  ' } }).length, 2)
  assert.equal(decomposeSystem({ name: 't', description: '', fields: [], body: '' }, undefined).length, 2)
})
