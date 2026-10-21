import { ChevronDown, Lock } from '@/components/icons'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { EditableText } from '@/components/EditableText'
import { FitList } from '@/components/FitList'
import { FormDialog } from '@/components/FormDialog'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { Segmented } from '@/components/Segmented'
import { UndoButtons } from '@/components/UndoButtons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LANGUAGES, useErrorText, useI18n, useT, type MessageKey } from '@/i18n'
import { Markdown } from '@/lib/markdown'
import { useMe, useProject, useProviders, useSaveLanguage, useSaveMember, useSaveProject, useSaveProvider } from '@/lib/queries'
import { readThemePref, saveTheme, type ThemePref } from '@/lib/theme'
import type { Language, ProviderSetting, ProviderSlot } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'

const SLOT_KEY: Record<ProviderSlot, MessageKey> = { text: 'settings.slot.text', vision: 'settings.slot.vision', speech: 'settings.slot.speech' }
const LANGUAGE_KEY: Record<Language, MessageKey> = { 'es-419': 'language.es-419', en: 'language.en' }
/** The providers each function accepts (src/providers/index.js: TEXT_PROVIDER, VISION_* inherits it, SPEECH_PROVIDER). */
const PROVIDERS_BY_SLOT: Record<ProviderSlot, readonly string[]> = {
  text: ['anthropic', 'deepseek', 'groq', 'openrouter', 'gemini', 'openai-compatible'],
  vision: ['anthropic', 'deepseek', 'groq', 'openrouter', 'gemini', 'openai-compatible'],
  speech: ['groq-speech'],
}
/** The server variable that holds each provider's key (the keys never reach the panel: MASTER-SPEC §4.6). */
const KEY_VARIABLE: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  groq: 'GROQ_API_KEY',
  'groq-speech': 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  gemini: 'GEMINI_API_KEY',
  'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
}
const COLUMNS = 'sm:grid-cols-[5.5rem_minmax(8rem,1fr)_minmax(12rem,1.3fr)_10rem]'

export function Settings() {
  const t = useT()
  const me = useMe().data
  const undo = useUndoStack()
  const editor = me?.role === 'editor'

  return (
    <UndoProvider stack={undo}>
      <Page cols={12}>
        <PageHeader title={t('nav.settings')} aside={editor ? <UndoButtons stack={undo} /> : undefined} />
        <div className="grid min-h-0 flex-1 md:grid-rows-[minmax(0,1fr)] gap-x-10 gap-y-5 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Account />
            <Theme />
          </div>
          <div className="flex min-h-0 min-w-0 flex-col gap-5">
            <Project editor={editor} />
            {editor && <Providers />}
          </div>
        </div>
      </Page>
    </UndoProvider>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Account() {
  const t = useT()
  const me = useMe().data
  const saveLanguage = useSaveLanguage()
  const saveMember = useSaveMember()
  const [changing, setChanging] = useState(false)
  const { language } = useI18n()

  return (
    <Section title={t('settings.account')}>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">{t('settings.name')}</dt>
        <dd>{me?.name}</dd>
        <dt className="text-muted">{t('settings.email')}</dt>
        <dd className="break-all">{me?.email}</dd>
        <dt className="text-muted">{t('settings.role')}</dt>
        <dd>{me?.role === 'editor' ? t('team.roleEditor') : t('team.roleMember')}</dd>
        <dt className="text-muted">{t('settings.language')}</dt>
        <dd>
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-edge bg-glass px-2.5 text-sm hover:border-accent" aria-label={t('settings.languageAria', { value: t(LANGUAGE_KEY[language]) })}>
              {t(LANGUAGE_KEY[language])}
              <ChevronDown size={13} aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={language} onValueChange={(v) => saveLanguage.mutate(v as Language)}>
                {LANGUAGES.map((code) => (
                  <DropdownMenuRadioItem key={code} value={code}>
                    {t(LANGUAGE_KEY[code])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </dd>
        <dt className="text-muted">{t('settings.password')}</dt>
        <dd>
          <Button size="sm" onClick={() => setChanging(true)}>
            <Lock size={13} aria-hidden /> {t('settings.changePassword')}
          </Button>
        </dd>
      </dl>
      <FormDialog
        open={changing}
        onOpenChange={setChanging}
        title={t('settings.changePassword')}
        submitLabel={t('common.save')}
        fields={[
          { name: 'current_password', label: t('settings.currentPassword'), required: true, type: 'password', autoComplete: 'current-password' },
          { name: 'new_password', label: t('settings.newPassword'), required: true, type: 'password', autoComplete: 'new-password' },
        ]}
        onSubmit={(v) => saveMember.mutateAsync({ id: me?.id ?? '', self: true, patch: { current_password: v.current_password, new_password: v.new_password } })}
      />
    </Section>
  )
}

function Theme() {
  const t = useT()
  const [theme, setTheme] = useState<ThemePref>(readThemePref)
  return (
    <Section title={t('settings.theme')}>
      <Segmented
        label={t('settings.theme')}
        value={theme}
        onChange={(v) => {
          setTheme(v)
          saveTheme(v)
        }}
        options={[
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') },
          { value: 'system', label: t('settings.themeSystem') },
        ]}
      />
    </Section>
  )
}

/** Project description in markdown: the whole team sees it, the Editor changes it in place or by uploading a `.md` file. */
function Project({ editor }: { editor: boolean }) {
  const t = useT()
  const errorText = useErrorText()
  const undo = useUndo()
  const project = useProject()
  const save = useSaveProject()
  const upload = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const current = project.data?.description ?? ''

  const change = (next: string) => undo.run({ label: t('project.edited'), redo: () => save.mutateAsync({ description: next }), undo: () => save.mutateAsync({ description: current }) })

  /** A file replaces the description; undo goes back to the previous text. */
  const replaceWith = async (file: File) => {
    setProblem(null)
    const before = current
    try {
      await undo.run({ label: t('project.uploaded'), redo: () => save.mutateAsync({ file }), undo: () => save.mutateAsync({ description: before }) })
    } catch (err) {
      setProblem(errorText(err))
    }
  }

  return (
    <section className="flex min-h-0 min-w-0 max-h-[55%] flex-col gap-3 border-t border-line-strong pt-3">
      <div className="flex items-center justify-between gap-2">
        <h2>{t('project.title')}</h2>
        {editor && (
          <>
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
            <Button size="sm" onClick={() => upload.current?.click()}>
              {t('project.upload')}
            </Button>
          </>
        )}
      </div>
      {/* The description can be as long as a master spec: it is a lane with its own declared scrolling. */}
      <div data-lane="project-description" className="glass leaf scroll-thin min-h-0 overflow-y-auto px-4 py-3 text-sm">
        <EditableText
          value={current}
          label={t('project.title')}
          multiline
          prose
          canEdit={editor}
          placeholder={t('project.empty')}
          render={(v) => <Markdown source={v} />}
          onSave={change}
        />
      </div>
      {problem && (
        <p role="alert" className="text-xs text-danger">
          {problem}
        </p>
      )}
    </section>
  )
}

function Providers() {
  const t = useT()
  const providers = useProviders(true)
  const rows = useMemo(() => providers.data ?? [], [providers.data])
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 border-t border-line-strong pt-3">
      <h2>{t('settings.providers')}</h2>
      <FitList
        rows={rows}
        rowKey={(p) => p.slot}
        label={t('settings.providers')}
        header={
          <div className={`hidden gap-4 border-b border-line bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-4 py-2 text-sm font-semibold text-muted sm:grid ${COLUMNS}`}>
            <span>{t('settings.function')}</span>
            <span>{t('settings.provider')}</span>
            <span>{t('settings.model')}</span>
            <span>{t('settings.status')}</span>
          </div>
        }
        renderRow={(p) => <ProviderRow provider={p} />}
        empty={<p className="px-3 py-6 text-center text-sm text-muted">{providers.isPending ? t('common.loading') : t('settings.noProviders')}</p>}
      />
    </section>
  )
}

function ProviderRow({ provider: p }: { provider: ProviderSetting }) {
  const t = useT()
  const { has } = useI18n()
  const undo = useUndo()
  const save = useSaveProvider()
  const errorText = useErrorText()
  const required = (v: string) => (v ? null : t('common.required'))

  /** Each provider change is an operation undone with the previous values. */
  const change = (next: { provider?: string; model?: string }) => {
    const before = { slot: p.slot, provider: p.provider, model: p.model }
    return undo.run({ label: t('settings.providerEdited'), redo: () => save.mutateAsync({ ...before, ...next }), undo: () => save.mutateAsync(before) })
  }
  const reasonKey = p.reason ? `provider.reason.${p.reason}` : ''
  const reason = reasonKey && has(reasonKey) ? t(reasonKey as MessageKey) : (p.reason ?? t('provider.unavailable'))

  return (
    <div className={`grid items-start gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 ${COLUMNS}`}>
      <span className="text-sm font-medium">{t(SLOT_KEY[p.slot])}</span>
      {PROVIDERS_BY_SLOT[p.slot].length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex min-h-6 max-w-full items-center gap-1 self-start rounded-md border border-transparent px-1.5 text-left text-sm hover:border-line-strong hover:bg-raised" aria-label={t('settings.providerOf', { slot: t(SLOT_KEY[p.slot]) })}>
            <span className="min-w-0 break-words">{p.provider || t('editable.empty')}</span>
            <ChevronDown size={12} aria-hidden className="shrink-0 text-muted" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {/* The open menu names its function: it may cover the row it belongs to (J1-A-51). */}
            <DropdownMenuLabel>{t('settings.providerOf', { slot: t(SLOT_KEY[p.slot]) })}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={p.provider} onValueChange={(v) => change({ provider: v }).catch(() => {})}>
              {PROVIDERS_BY_SLOT[p.slot].map((name) => (
                <DropdownMenuRadioItem key={name} value={name}>
                  {name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        // A function with one provider has nothing to choose: plain text, no control that offers nothing.
        <span className="px-1.5 text-sm">{p.provider || t('editable.empty')}</span>
      )}
      <EditableText value={p.model} label={t('settings.modelOf', { slot: t(SLOT_KEY[p.slot]) })} validate={required} mono onSave={(v) => change({ model: v })} />
      <span title={p.available === false ? reason : undefined} className="flex flex-col items-start gap-0.5">
        <Badge tone={p.available === false ? 'danger' : 'answered'}>{p.available === false ? t('provider.unavailable') : t('provider.available')}</Badge>
        {p.available === false && (
          <span className="text-sm leading-tight text-fg">
            {reason}
            {p.reason === 'missing_api_key' && KEY_VARIABLE[p.provider] && <span className="block font-mono text-xs text-muted">{KEY_VARIABLE[p.provider]}</span>}
          </span>
        )}
        {save.isError && <span role="alert" className="text-xs leading-tight text-danger">{errorText(save.error)}</span>}
      </span>
    </div>
  )
}
