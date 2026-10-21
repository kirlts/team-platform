import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decomposeSystem, decomposeUser, membersBlock } from './prompts.js'

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
