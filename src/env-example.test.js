import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Toda variable de entorno que lee src/config.js figura por nombre en .env.example: sin una variable
// escondida que sólo conozca quien lee el código.
test('.env.example nombra todas las variables de src/config.js, sin valores', () => {
  const config = readFileSync(new URL('./config.js', import.meta.url), 'utf8')
  const ejemplo = readFileSync(new URL('../.env.example', import.meta.url), 'utf8')
  const leidas = [...config.matchAll(/\b(?:texto|entero|decimal|booleano|lista|opcion|json)\(env, '([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1])
  assert.ok(leidas.length > 80)
  const faltan = leidas.filter((n) => !new RegExp(`^#?\\s?${n}=`, 'm').test(ejemplo))
  assert.deepEqual(faltan, [])
  // Ningún valor: toda línea activa termina en «=».
  const conValor = ejemplo.split('\n').filter((l) => /^[A-Z][A-Z0-9_]*=./.test(l))
  assert.deepEqual(conValor, [])
})
