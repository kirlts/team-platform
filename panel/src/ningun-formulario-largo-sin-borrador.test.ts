// @vitest-environment node
// TP-04 (soft-locks 2026-11-04). What a person writes does not live only in `useState`: a form that takes a long text keeps it as a draft
// (`useDraft`, in `sessionStorage`) or says why it does not need to. The two forms of a send, the bar of Inicio and the reply, lost their text on every
// link of the sidebar and on Atrás.
// Fails on the tree before the change: `ComposeBar.tsx` kept the text in the former store only and `ReplyForm.tsx` kept `body` in `useState`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('.', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : files(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}
const read = (f: string) => readFileSync(f, 'utf8')
const all = files(SRC)
const rel = (f: string) => relative(SRC, f).replaceAll('\\', '/')

/** The modules that draw a text area, and why each one that keeps no draft does not need one. A new module with a text area has to be named here or use `useDraft`. */
const WITHOUT_DRAFT: Record<string, string> = {
  'components/EditableText.tsx': 'edit in place: the value is saved on leaving the field and Escape cancels',
  'components/FormDialog.tsx': 'a dialog of the screen: leaving it with changes is stopped by the dialog itself (dirty)',
  'components/TemplateEditor.tsx': 'a dialog of the screen: leaving it with changes is stopped by the dialog itself (dirty)',
  'components/ForwardMessage.tsx': 'a dialog of the screen: leaving it with changes is stopped by the dialog itself (dirty)',
  'components/ProjectEditor.tsx': 'a setting with its own Guardar, one line of the settings page',
  'components/InstallationSettings.tsx': 'a setting with its own Guardar, one line of the settings page',
  'components/MentionTextarea.tsx': 'the control; the draft belongs to the form that uses it',
  'components/ui/input.tsx': 'the primitive',
}

describe('a long text is a draft or it says why not', () => {
  const hosts = all.filter((f) => /<textarea|<Textarea|<MentionTextarea/.test(read(f)))

  it('every module that takes media with its text (a send) keeps the text with useDraft', () => {
    const sends = all.filter((f) => /\buseMediaDraft\(/.test(read(f)) && !rel(f).startsWith('lib/'))
    expect(sends.map(rel).sort()).toEqual(['components/ComposeBar.tsx', 'components/ReplyForm.tsx'])
    const without = sends.filter((f) => !/\buseDraft[<(]/.test(read(f))).map(rel)
    expect(without).toEqual([])
  })

  it('every other module with a text area is named, with its reason', () => {
    const unnamed = hosts.map(rel).filter((f) => !(f in WITHOUT_DRAFT) && !/\buseDraft[<(]/.test(read(join(SRC, f))))
    expect(unnamed).toEqual([])
  })

  it('the names above still exist', () => {
    const missing = Object.keys(WITHOUT_DRAFT).filter((f) => !hosts.map(rel).includes(f))
    expect(missing).toEqual([])
  })
})
