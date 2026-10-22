import { ChevronDown, Lock } from '@/components/icons'
import { SELECT_FACE } from '@/components/NativeSelect'
import { useState, type ReactNode } from 'react'
import { DataReset } from '@/components/DataReset'
import { FormDialog } from '@/components/FormDialog'
import { PageHeader } from '@/components/PageHeader'
import { ProjectEditor } from '@/components/ProjectEditor'
import { ProviderSettings } from '@/components/ProviderSettings'
import { Segmented } from '@/components/Segmented'
import { SettingHint } from '@/components/SettingHint'
import { PublicationSetting } from '@/components/PublicationSetting'
import { UndoButtons } from '@/components/UndoButtons'
import { UiTelemetrySetting } from '@/components/UiTelemetrySetting'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LANGUAGES, useI18n, useT, type MessageKey } from '@/i18n'
import { useMe, useSaveLanguage, useSaveMember } from '@/lib/queries'
import { readThemePref, saveTheme, type ThemePref } from '@/lib/theme'
import type { Language } from '@/lib/types'
import { UndoProvider, useUndoStack } from '@/lib/undo'

const LANGUAGE_KEY: Record<Language, MessageKey> = { 'es-419': 'language.es-419', en: 'language.en' }
/**
 * Configuración scrolls as a page (UD-123): the project description grows with its text and the height of the screen is the
 * content's, so it does not use `Page` (which gives a view the height of the window). The `<main>` of the shell is the scrolling region.
 */
export function Settings() {
  const t = useT()
  const me = useMe().data
  const undo = useUndoStack()
  const editor = me?.role === 'editor'

  return (
    <UndoProvider stack={undo}>
      <div data-scrolling-page className="flex w-full max-w-[72rem] flex-col gap-5 px-5 py-6 md:px-10 md:py-5">
        <PageHeader title={t('nav.settings')} aside={editor ? <UndoButtons stack={undo} /> : undefined} />
        <div className="grid items-start gap-x-10 gap-y-5 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Account />
            <Theme />
            {editor && <PublicationSetting />}
            {editor && <UiTelemetrySetting />}
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <Project editor={editor} />
            {editor && <ProviderSettings />}
          </div>
        </div>
        {editor && <DataReset />}
      </div>
    </UndoProvider>
  )
}

function Section({ title, hint, hintId, children }: { title: string; hint?: string; hintId?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line-strong pt-3">
      <div className="flex flex-col gap-0.5">
        <h2>{title}</h2>
        {hint && hintId && <SettingHint id={hintId}>{hint}</SettingHint>}
      </div>
      {children}
    </section>
  )
}

/** One setting: label, value or control, and its explanation under both. The control names the explanation in `aria-describedby`. */
function Row({ label, hint, hintId, children }: { label: string; hint: string; hintId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd aria-describedby={hintId} className="flex flex-col items-start gap-1">
        {children}
        <SettingHint id={hintId}>{hint}</SettingHint>
      </dd>
    </div>
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
      <dl className="flex flex-col gap-3 text-sm">
        <Row label={t('settings.name')} hint={t('hint.account.name')} hintId="hint-account-name">
          <span>{me?.name}</span>
        </Row>
        <Row label={t('settings.email')} hint={t('hint.account.email')} hintId="hint-account-email">
          <span className="break-all">{me?.email}</span>
        </Row>
        <Row label={t('settings.role')} hint={t('hint.account.role')} hintId="hint-account-role">
          <span>{me?.role === 'editor' ? t('team.roleEditor') : t('team.roleMember')}</span>
        </Row>
        <Row label={t('settings.language')} hint={t('hint.account.language')} hintId="hint-account-language">
          <DropdownMenu>
            <DropdownMenuTrigger aria-describedby="hint-account-language" className={`${SELECT_FACE} inline-flex min-w-40 items-center justify-between gap-2`} aria-label={t('settings.languageAria', { value: t(LANGUAGE_KEY[language]) })}>
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
        </Row>
        <Row label={t('settings.password')} hint={t('hint.account.password')} hintId="hint-account-password">
          <Button size="sm" aria-describedby="hint-account-password" onClick={() => setChanging(true)}>
            <Lock size={13} aria-hidden /> {t('settings.changePassword')}
          </Button>
        </Row>
      </dl>
      <FormDialog
        open={changing}
        onOpenChange={setChanging}
        title={t('settings.changePassword')}
        submitLabel={t('common.save')}
        fields={[
          { name: 'current_password', label: t('settings.currentPassword'), required: true, type: 'password', autoComplete: 'current-password' },
          { name: 'new_password', label: t('settings.newPassword'), required: true, type: 'password', autoComplete: 'new-password', hint: me?.password_min_length ? t('password.min', { n: me.password_min_length }) : undefined },
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
    <Section title={t('settings.theme')} hint={t('hint.theme')} hintId="hint-theme">
      <Segmented
        label={t('settings.theme')}
        describedBy="hint-theme"
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

/** Project description in markdown: the whole team reads it, the Editor writes it (UD-024) in an editor that grows with its text (UD-123). */
function Project({ editor }: { editor: boolean }) {
  const t = useT()
  return (
    <Section title={t('project.title')} hint={t('hint.project')} hintId="hint-project">
      <ProjectEditor editor={editor} describedBy="hint-project" />
    </Section>
  )
}
