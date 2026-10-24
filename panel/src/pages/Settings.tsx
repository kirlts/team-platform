import { ChevronDown, Lock } from '@/components/icons'
import { SELECT_FACE } from '@/components/NativeSelect'
import { useState, type ReactNode } from 'react'
import { AuditLog } from '@/components/AuditLog'
import { DataReset } from '@/components/DataReset'
import { FormDialog } from '@/components/FormDialog'
import { FramingSetting, ProjectNameSetting } from '@/components/InstallationSettings'
import { PageHeader } from '@/components/PageHeader'
import { QueuePanel } from '@/components/QueuePanel'
import { ProjectEditor } from '@/components/ProjectEditor'
import { ProviderSettings } from '@/components/ProviderSettings'
import { Segmented } from '@/components/Segmented'
import { SettingHint } from '@/components/SettingHint'
import { SettingsBox } from '@/components/SettingsBox'
import { PublicationSetting } from '@/components/PublicationSetting'
import { UndoButtons } from '@/components/UndoButtons'
import { UiTelemetrySetting } from '@/components/UiTelemetrySetting'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { LANGUAGES, useI18n, useT, type MessageKey } from '@/i18n'
import type { Language } from '@team-platform/client'
import { useMe, useSaveLanguage, useSaveMember } from '@team-platform/client/react'
import { readThemePref, saveTheme, type ThemePref } from '@/lib/theme'
import { UndoProvider, useUndoStack } from '@/lib/undo'
import { cn } from '@/lib/utils'

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
        <div className="grid items-start gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Account />
            <Theme />
            {editor && <PublicationSetting />}
            {editor && <UiTelemetrySetting />}
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <Project editor={editor} />
            {editor && <ProjectNameSetting />}
            {editor && <FramingSetting />}
          </div>
        </div>
        {editor && <ProviderSettings />}
        {editor && <DataReset />}
        {/* The queue draws its own rule at the top: inside the box it is not needed. */}
        {editor && (
          <div className="glass leaf p-5 [&>section]:border-t-0 [&>section]:pt-0">
            <QueuePanel />
          </div>
        )}
        {editor && <AuditLog />}
      </div>
    </UndoProvider>
  )
}

/** One setting of the account: its label over its value, as a group of data. */
function Row({ label, hint, hintId, wide = false, children }: { label: string; hint?: string; hintId?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', wide && 'sm:col-span-2')}>
      <dt className="rotulo">{label}</dt>
      <dd aria-describedby={hintId} className="flex min-w-0 flex-col items-start gap-1 text-sm">
        {children}
        {hint && hintId && <SettingHint id={hintId}>{hint}</SettingHint>}
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
    <SettingsBox title={t('settings.account')}>
      <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <Row label={t('settings.name')}>
          <span>{me?.name}</span>
        </Row>
        <Row label={t('settings.email')}>
          <span className="break-all">{me?.email}</span>
        </Row>
        <Row label={t('settings.role')}>
          <span>{me?.role === 'editor' ? t('team.roleEditor') : t('team.roleMember')}</span>
        </Row>
        <Row label={t('settings.password')}>
          <Button size="sm" onClick={() => setChanging(true)}>
            <Lock size={16} aria-hidden /> {t('settings.changePassword')}
          </Button>
        </Row>
        <Row wide label={t('settings.language')} hint={t('hint.account.language')} hintId="hint-account-language">
          <DropdownMenu>
            <DropdownMenuTrigger aria-describedby="hint-account-language" className={`${SELECT_FACE} inline-flex min-w-40 items-center justify-between gap-2`} aria-label={t('settings.languageAria', { value: t(LANGUAGE_KEY[language]) })}>
              {t(LANGUAGE_KEY[language])}
              <ChevronDown size={16} aria-hidden />
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
    </SettingsBox>
  )
}

function Theme() {
  const t = useT()
  const [theme, setTheme] = useState<ThemePref>(readThemePref)
  return (
    <SettingsBox
      title={t('settings.theme')}
      aside={
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
      }
    />
  )
}

/** Project description in markdown: the whole team reads it, the Editor writes it (UD-024) in an editor that grows with its text (UD-123). */
function Project({ editor }: { editor: boolean }) {
  const t = useT()
  return (
    <SettingsBox title={t('project.title')} hint={t('hint.project')} hintId="hint-project">
      <ProjectEditor editor={editor} describedBy="hint-project" />
    </SettingsBox>
  )
}
