import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle } from '@/components/icons'
import { LoadState } from '@/components/LoadState'
import { MoreMenu } from '@/components/MoreMenu'
import { SaveDot, type SaveTone } from '@/components/SaveDot'
import { useErrorText, useI18n, useT } from '@/i18n'
import { Markdown } from '@/lib/markdown'
import { useProject, useSaveProject } from '@team-platform/client/react'
import { useUndo } from '@/lib/undo'
import { cn } from '@/lib/utils'

/** Share of the cap from which the counter warns. A fixed fraction of the cap the server declares, not a time or a size of its own. */
const NEAR_CAP = 0.9

type Status = 'idle' | 'saving' | 'error'

/**
 * Editor of the project description (UD-024, UD-123). A markdown `textarea` as wide as its column that grows with its text:
 * it has no scroll of its own and no folded frame, so the page is what scrolls. Saved on leaving the field and with Ctrl+S;
 * there is no save by clock (RULES 3: a delay that governs the operation is born declared or does not exist). Every save is an
 * undoable operation of the screen. Ctrl+Z inside the field is the browser's own, over the unsaved text; the stack's shortcut
 * does not act there. The member reads the same text rendered, whole.
 *
 * `describedBy` is the id of the SettingHint of the section.
 */
export function ProjectEditor({ editor, describedBy }: { editor: boolean; describedBy?: string }) {
  const t = useT()
  const { language } = useI18n()
  const errorText = useErrorText()
  const undo = useUndo()
  const project = useProject()
  const save = useSaveProject()
  const current = project.data?.description ?? ''
  const max = project.data?.max_chars
  const [draft, setDraft] = useState(current)
  const [status, setStatus] = useState<Status>('idle')
  const [problem, setProblem] = useState<string | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  /** What the server held when the draft was last aligned with it: a draft that differs from it has unsaved changes. */
  const aligned = useRef(current)

  // The server's text reaches the field (a first load, an undo, a replacement by file) unless the person has unsaved changes.
  useEffect(() => {
    if (draft === aligned.current) setDraft(current)
    aligned.current = current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  // Height equal to the text's, measured after each change and when the column changes width (the lines wrap differently).
  const fit = () => {
    const el = field.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`
  }
  const loaded = Boolean(project.data)
  useLayoutEffect(fit, [draft, editor, loaded])
  useEffect(() => {
    const el = field.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth
        fit()
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [editor, loaded])

  const length = [...draft].length
  const over = max !== undefined && length > max
  const near = max !== undefined && !over && length >= max * NEAR_CAP
  const dirty = draft !== current

  const commit = async () => {
    if (!dirty || over || status === 'saving') return
    const next = draft
    const before = current
    setStatus('saving')
    setProblem(null)
    try {
      await undo.run({ label: t('project.edited'), redo: () => save.mutateAsync({ description: next }), undo: () => save.mutateAsync({ description: before }) })
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setProblem(errorText(err))
    }
  }

  /** A file replaces the description; undo goes back to the previous text. */
  const replaceWith = async (file: File) => {
    setProblem(null)
    const before = current
    try {
      await undo.run({ label: t('project.uploaded'), redo: () => save.mutateAsync({ file }), undo: () => save.mutateAsync({ description: before }) }, { announce: t('project.replacedDone') })
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setProblem(errorText(err))
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([draft], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'proyecto.md'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  // Before the text arrives there is no field: typing over an empty draft would be lost when it loads.
  if (!project.data) return <LoadState query={project} rows={3} />

  if (!editor) {
    return current ? (
      <div data-project-reading className="glass leaf prose-block px-5 py-4 text-sm">
        <Markdown source={current} />
      </div>
    ) : (
      <p className="text-sm text-faint">{t('project.empty')}</p>
    )
  }

  const fmt = (n: number) => n.toLocaleString(language)
  const state: { text: string; tone: SaveTone } =
    status === 'saving' ? { text: t('project.saving'), tone: 'saving' }
    : status === 'error' ? { text: t('project.saveError', { cause: problem ?? '' }), tone: 'error' }
    : dirty ? { text: t('project.dirty'), tone: 'dirty' }
    : { text: t('project.saved'), tone: 'saved' }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        ref={field}
        rows={16}
        value={draft}
        aria-label={t('project.title')}
        aria-describedby={describedBy}
        aria-invalid={over ? true : undefined}
        placeholder={t('project.empty')}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value)
          if (status === 'error') setStatus('idle')
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          const key = e.key.toLowerCase()
          if ((e.ctrlKey || e.metaKey) && key === 's') {
            e.preventDefault()
            void commit()
          } else if ((e.ctrlKey || e.metaKey) && (key === 'z' || key === 'y')) {
            // The field's own history over the unsaved text; the screen's stack does not take the shortcut from it.
            e.stopPropagation()
          }
        }}
        className={cn('well block w-full resize-y overflow-y-hidden rounded-field border px-4 py-3 font-mono text-sm leading-relaxed outline-none focus-visible:outline-none', over ? '!border-danger' : '!border-[var(--field-border)] focus:!border-accent')}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <SaveDot tone={state.tone} data-project-status>
            {state.text}
          </SaveDot>
          <span data-project-counter className={cn('inline-flex items-center gap-1.5 tabular-nums', over ? 'font-semibold text-danger' : near ? 'font-semibold text-fg' : 'text-muted')}>
            {(over || near) && <AlertTriangle size={16} aria-hidden />}
            {max === undefined ? t('project.counterFree', { n: fmt(length) }) : t('project.counter', { n: fmt(length), max: fmt(max) })}
            {over ? ` · ${t('project.over')}` : near ? ` · ${t('project.near')}` : ''}
          </span>
        </div>
        <input
          ref={upload}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void replaceWith(file)
          }}
        />
        <MoreMenu
          items={[
            { key: 'upload', label: t('project.upload'), onSelect: () => upload.current?.click() },
            { key: 'download', label: t('project.download'), onSelect: download },
          ]}
        />
      </div>
    </div>
  )
}
