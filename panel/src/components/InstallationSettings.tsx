import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from '@/components/icons'
import { SettingHint } from '@/components/SettingHint'
import { Button } from '@/components/ui/button'
import { LANGUAGES, useErrorText, useI18n, useT, type MessageKey } from '@/i18n'
import type { Language } from '@team-platform/client'
import { useAnalysisSettings, useProject, useSaveFraming, useSaveProjectName } from '@team-platform/client/react'
import { useUndo } from '@/lib/undo'
import { cn } from '@/lib/utils'

const LANGUAGE_KEY: Record<Language, MessageKey> = { 'es-419': 'language.es-419', en: 'language.en' }
const FIELD = 'well block w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:outline-none'

/**
 * A text that is its own control (in-place edit): leaving the field saves, Escape discards, and a text over the cap stays
 * open with the reason under it. Every save goes to the undo stack of the screen. `multiline` draws a textarea that grows.
 */
function InPlaceText({ value, max, label, describedBy, multiline = false, undoLabel, onSave, testId }: {
  value: string
  max?: number
  label: string
  describedBy: string
  multiline?: boolean
  undoLabel: string
  onSave: (next: string) => Promise<unknown>
  testId: string
}) {
  const t = useT()
  const { language } = useI18n()
  const errorText = useErrorText()
  const undo = useUndo()
  const [draft, setDraft] = useState(value)
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setDraft(value), [value])
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`
  }, [draft])

  const length = [...draft].length
  const over = max !== undefined && length > max
  const commit = async () => {
    if (draft === value || over || saving) return
    const next = draft
    const before = value
    setSaving(true)
    setProblem(null)
    try {
      await undo.run({ label: undoLabel, redo: () => onSave(next), undo: () => onSave(before) })
    } catch (err) {
      setProblem(errorText(err))
    } finally {
      setSaving(false)
    }
  }
  const common = {
    value: draft,
    'aria-label': label,
    'aria-describedby': describedBy,
    'aria-invalid': over || problem ? true : undefined,
    'data-setting-field': testId,
    spellCheck: false,
    onBlur: () => void commit(),
    className: cn(FIELD, over || problem ? '!border-danger' : '!border-edge focus:!border-accent', multiline && 'resize-y overflow-y-hidden leading-relaxed'),
  }
  const keys = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setDraft(value)
      setProblem(null)
    } else if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      e.currentTarget.blur()
    } else if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
      e.stopPropagation() // the field's own history over the unsaved text
    }
  }
  return (
    <div className="flex flex-col gap-1">
      {multiline ? (
        <textarea ref={area} rows={3} {...common} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} />
      ) : (
        <input type="text" {...common} onChange={(e) => setDraft(e.target.value)} onKeyDown={keys} />
      )}
      {(over || problem || (max !== undefined && multiline)) && (
        <span className={cn('inline-flex items-center gap-1.5 text-xs tabular-nums', over || problem ? 'font-semibold text-danger' : 'text-muted')}>
          {(over || problem) && <AlertTriangle size={13} aria-hidden />}
          {problem ?? t('project.counter', { n: length.toLocaleString(language), max: (max ?? 0).toLocaleString(language) })}
        </span>
      )}
    </div>
  )
}

function Section({ title, hint, hintId, children }: { title: string; hint: string; hintId: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <div className="flex flex-col gap-0.5">
        <h2>{title}</h2>
        <SettingHint id={hintId}>{hint}</SettingHint>
      </div>
      {children}
    </section>
  )
}

/** Project name (H-3722): the one the top bar shows. Editor only; empty goes back to PROJECT_NAME. */
export function ProjectNameSetting() {
  const t = useT()
  const project = useProject().data
  const save = useSaveProjectName()
  if (!project) return null
  return (
    <Section title={t('settings.projectName')} hint={t('hint.projectName')} hintId="hint-project-name">
      <InPlaceText
        testId="project-name"
        value={project.name}
        max={project.name_max_chars}
        label={t('settings.projectName')}
        describedBy="hint-project-name"
        undoLabel={t('settings.projectName')}
        onSave={(name) => save.mutateAsync(name)}
      />
    </Section>
  )
}

/** Analysis framing (H-3722): the first paragraph of the analyzer's instructions, one text per language. Editor only. */
export function FramingSetting() {
  const t = useT()
  const settings = useAnalysisSettings().data
  const save = useSaveFraming()
  if (!settings) return null
  return (
    <Section title={t('settings.framing')} hint={t('hint.framing')} hintId="hint-framing">
      <dl className="flex flex-col gap-3 text-sm">
        {LANGUAGES.map((lang) => {
          const item = settings.framing[lang]
          return (
            <div key={lang} data-framing={lang} className="flex flex-col gap-1">
              <dt data-repeat-ok="language" className="flex items-center justify-between gap-2 text-muted">
                {t(LANGUAGE_KEY[lang])}
                {item.custom && (
                  <Button size="sm" variant="ghost" className="text-accent-deep" onClick={() => void save.mutateAsync({ [lang]: '' })}>
                    {t('settings.framingReset')}
                  </Button>
                )}
              </dt>
              <dd>
                <InPlaceText
                  testId={`framing-${lang}`}
                  multiline
                  value={item.value}
                  max={settings.max_chars}
                  label={`${t('settings.framing')} · ${t(LANGUAGE_KEY[lang])}`}
                  describedBy="hint-framing"
                  undoLabel={t('settings.framing')}
                  onSave={(text) => save.mutateAsync({ [lang]: text })}
                />
              </dd>
            </div>
          )
        })}
      </dl>
    </Section>
  )
}
