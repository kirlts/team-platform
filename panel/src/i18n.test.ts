// @vitest-environment node
// UD-018: toda la interfaz sale de los dos catálogos. Esta prueba comprueba, sin ejecutar nada:
//   - los dos catálogos tienen exactamente las mismas claves, y las mismas variables en cada mensaje;
//   - cada clave que el código nombra existe;
//   - ningún texto visible está escrito fuera de los catálogos: ni texto en un JSX, ni un atributo
//     visible (aria-label, placeholder, title, alt, label), ni un literal con acentos.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'rolldown/utils'
import { describe, expect, it } from 'vitest'
import { en } from './i18n/en'
import { es419 } from './i18n/es-419'

const SRC = fileURLToPath(new URL('.', import.meta.url))
const CATALOGS = new Set(['i18n/en.ts', 'i18n/es-419.ts'])
const VISIBLE_ATTRS = new Set(['aria-label', 'aria-description', 'aria-roledescription', 'placeholder', 'title', 'alt', 'label', 'summary'])
const VISIBLE_KEYS = new Set(['label', 'title', 'placeholder', 'description', 'submitLabel', 'message', 'reason'])
const WORDS = /\p{L}{2,}/u
/** Addresses and format examples are not language. */
const NOT_LANGUAGE = /^(https?:\/\/|[a-z]+:\/\/)/
const SPANISH_ONLY = /[áéíóúñ¿¡ÁÉÍÓÚÑ]/

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : sources(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

type Node = { type: string; [key: string]: unknown }

function walk(node: unknown, visit: (n: Node, parent: Node | null) => void, parent: Node | null = null) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit, parent))
  if (!node || typeof node !== 'object') return
  const n = node as Node
  if (typeof n.type === 'string') {
    visit(n, parent)
    parent = n
  }
  for (const value of Object.values(n)) if (value && typeof value === 'object') walk(value, visit, parent)
}

const str = (n: unknown): string | null => {
  const node = n as Node | null
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral') {
    const quasis = node.quasis as { value: { cooked: string } }[]
    return quasis.map((q) => q.value.cooked).join('')
  }
  return null
}

/** Visible text written in the code: [where, text]. */
export function literalsIn(file: string, code: string): [string, string][] {
  const raw: [string, string][] = []
  const out = { push: (entry: [string, string]) => (NOT_LANGUAGE.test(entry[1]) ? 0 : raw.push(entry)) }
  const ast = parseSync(file, code, { lang: file.endsWith('x') ? 'tsx' : 'ts' })
  const line = (offset: number) => code.slice(0, offset).split('\n').length
  walk(ast.program, (n, parent) => {
    if (n.type === 'JSXText') {
      const text = String(n.value).trim()
      if (WORDS.test(text)) out.push([`texto en JSX línea ${line(n.start as number)}`, text])
    }
    if (n.type === 'JSXAttribute') {
      const name = ((n.name as Node).name as string) ?? ''
      const value = n.value as Node | null
      const text = value?.type === 'JSXExpressionContainer' ? str(value.expression) : str(value)
      if (text !== null && VISIBLE_ATTRS.has(name) && WORDS.test(text)) out.push([`atributo ${name} línea ${line(n.start as number)}`, text])
    }
    if (n.type === 'JSXExpressionContainer' && parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment')) {
      const text = str(n.expression)
      if (text !== null && WORDS.test(text)) out.push([`literal en JSX línea ${line(n.start as number)}`, text])
    }
    if (n.type === 'Property' && !n.computed) {
      const key = (n.key as Node).name ?? (n.key as Node).value
      const text = str(n.value)
      if (text !== null && VISIBLE_KEYS.has(String(key)) && WORDS.test(text)) out.push([`propiedad ${String(key)} línea ${line(n.start as number)}`, text])
    }
    if (n.type === 'Literal' && typeof n.value === 'string' && SPANISH_ONLY.test(n.value) && parent?.type !== 'ImportDeclaration') {
      out.push([`literal con acentos línea ${line(n.start as number)}`, n.value])
    }
  })
  return raw
}

describe('catálogos (UD-018)', () => {
  it('tienen exactamente las mismas claves', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es419).sort())
  })

  it('cada mensaje usa las mismas variables en los dos idiomas', () => {
    const vars = (m: unknown) => {
      const text = typeof m === 'string' ? m : JSON.stringify(m)
      return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].sort()
    }
    const different = Object.keys(es419).filter((k) => JSON.stringify(vars((es419 as Record<string, unknown>)[k])) !== JSON.stringify(vars((en as Record<string, unknown>)[k])))
    expect(different).toEqual([])
  })

  it('un mensaje con plural lo trae en las dos formas', () => {
    for (const [key, value] of [...Object.entries(es419), ...Object.entries(en)]) {
      if (typeof value === 'object') expect(Object.keys(value).sort(), key).toEqual(['one', 'other'])
    }
  })

  it('ninguna clave queda vacía', () => {
    for (const [key, value] of [...Object.entries(es419), ...Object.entries(en)]) {
      expect(typeof value === 'string' ? value : value.one + value.other, key).not.toBe('')
    }
  })
})

describe('el código sólo nombra claves que existen', () => {
  it('cada clave literal del código está en el catálogo', () => {
    const keys = new Set(Object.keys(es419))
    const missing: string[] = []
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file)
      if (CATALOGS.has(rel) || rel.startsWith('i18n/')) continue
      const code = readFileSync(file, 'utf8')
      for (const m of code.matchAll(/\bt\(\s*'([a-z][A-Za-z]*(?:\.[A-Za-z0-9_-]+)+)'/g)) if (!keys.has(m[1])) missing.push(`${rel}: ${m[1]}`)
      for (const m of code.matchAll(/'((?:nav|common|home|compose|media|reply|replies|card|recipients|detail|areas|area|team|settings|status|filter|analysis|proposal|input|fields|undo|pager|editable|messages|login|menu|bell|brand|form|time|language|provider|tags|audio|app)\.[A-Za-z0-9_.-]+)'/g)) {
        if (!keys.has(m[1])) missing.push(`${rel}: ${m[1]}`)
      }
    }
    expect([...new Set(missing)]).toEqual([])
  })
})

describe('ningún texto visible fuera de los catálogos', () => {
  it('recognises the forms', () => {
    const found = literalsIn('x.tsx', `const a = <div title="Cerrar" className="x">Texto<span aria-label={'Abrir'} />{'otro'}</div>; const o = { label: 'Nombre' }`)
    expect(found.map(([where]) => where.split(' ')[0] + ' ' + where.split(' ')[1])).toEqual(expect.arrayContaining(['atributo title', 'texto en', 'atributo aria-label', 'literal en', 'propiedad label']))
  })

  it('cada archivo de src/ saca sus textos de t()', () => {
    const found: string[] = []
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file)
      if (rel.startsWith('i18n/')) continue
      for (const [where, text] of literalsIn(file, readFileSync(file, 'utf8'))) found.push(`${rel}: ${where}: «${text.slice(0, 50)}»`)
    }
    expect(found).toEqual([])
  })
})
