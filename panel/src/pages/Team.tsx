import { UserPlus } from '@/components/icons'
import { useMemo, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { EditableText } from '@/components/EditableText'
import { FitList } from '@/components/FitList'
import { FormDialog } from '@/components/FormDialog'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { UndoButtons } from '@/components/UndoButtons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useErrorText, useT, type MessageKey } from '@/i18n'
import { useCreateMember, useMe, useMembers, useSaveMember } from '@/lib/queries'
import type { Language, Member, Role } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'

/** Maximum length of the profile the API accepts (UD-023). */
const PROFILE_MAX = 4000
const LANGUAGE_KEY: Record<Language, MessageKey> = { 'es-419': 'language.es-419', en: 'language.en' }
const SHORT_LANGUAGE_KEY: Record<Language, MessageKey> = { 'es-419': 'language.short.es-419', en: 'language.short.en' }
const COLUMNS = 'md:grid-cols-[17rem_7rem_minmax(0,1fr)_7rem]'

/** An address that may only break after a separator, never in the middle of a word (J1-A-39). */
function withBreaks(email: string) {
  return email.split(/(?<=[.@_-])/).flatMap((part, i) => (i === 0 ? [part] : [<wbr key={i} />, part]))
}

/** Members with their responsibilities and domains. Each one edits their own; the Editor adds, and changes name, email and role of the others. */
export function Team() {
  const t = useT()
  const me = useMe().data
  const members = useMembers()
  const create = useCreateMember()
  const undo = useUndoStack()
  const [adding, setAdding] = useState(false)
  const editor = me?.role === 'editor'
  const rows = useMemo(() => members.data ?? [], [members.data])

  return (
    <UndoProvider stack={undo}>
      <Page cols={12}>
        <PageHeader
          title={t('nav.team')}
          aside={
            <div className="flex items-center gap-2">
              <UndoButtons stack={undo} />
              {editor && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <UserPlus size={14} aria-hidden /> {t('team.add')}
                </Button>
              )}
            </div>
          }
        />
        <FitList
          rows={rows}
          rowKey={(m) => m.id}
          label={t('nav.team')}
          header={
            <div className={`hidden gap-4 border-b border-line bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-4 py-2 text-sm font-semibold text-muted md:grid ${COLUMNS}`}>
              <span>{t('team.member')}</span>
              <span>{t('team.role')}</span>
              <span>{t('team.profile')}</span>
              <span />
            </div>
          }
          renderRow={(m) => <MemberRow member={m} self={m.id === me?.id} viewerIsEditor={editor} />}
          empty={<p className="px-3 py-8 text-center text-sm text-muted">{t('common.loading')}</p>}
        />
        <FormDialog
          open={adding}
          onOpenChange={setAdding}
          title={t('team.new')}
          submitLabel={t('common.create')}
          fields={[
            { name: 'name', label: t('team.fieldName'), required: true },
            { name: 'email', label: t('team.fieldEmail'), required: true, type: 'email', autoComplete: 'off' },
            { name: 'password', label: t('team.fieldPassword'), type: 'password', autoComplete: 'new-password' },
          ]}
          onSubmit={(v) => create.mutateAsync({ name: v.name, email: v.email, ...(v.password ? { password: v.password } : {}) })}
        />
      </Page>
    </UndoProvider>
  )
}

function MemberRow({ member, self, viewerIsEditor }: { member: Member; self: boolean; viewerIsEditor: boolean }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveMember()
  const errorText = useErrorText()
  const [problem, setProblem] = useState<string | null>(null)
  const roleLabel: Record<Role, string> = { member: t('team.roleMember'), editor: t('team.roleEditor') }
  const canEditPeople = viewerIsEditor

  /** Each save is an operation undone with the previous value. */
  const change = <K extends 'profile' | 'role' | 'name' | 'email' | 'active'>(key: K, next: Member[K]) => {
    const prev = member[key]
    const apply = (value: Member[K]) => save.mutateAsync({ id: member.id, self: self && key === 'profile', patch: { [key]: value } })
    return undo.run({ label: t('team.edited'), redo: () => apply(next), undo: () => apply(prev) })
  }
  const required = (v: string) => (v ? null : t('common.required'))
  /** Deactivating or reactivating is undone with the opposite gesture; the API refuses if it is oneself or the last Editor. */
  const toggleActive = () =>
    change('active', !member.active).then(
      () => setProblem(null),
      (err) => setProblem(errorText(err)),
    )

  return (
    <div className={`grid items-start gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 ${COLUMNS} ${member.active ? '' : 'bg-closed-bg/30'}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <Avatar name={member.name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <EditableText value={member.name} label={t('team.fieldName')} canEdit={canEditPeople} validate={required} onSave={(v) => change('name', v)} displayClassName="text-sm font-semibold" className="w-auto" />
            {self && <Badge tone="accent">{t('team.me')}</Badge>}
          </div>
          <EditableText value={member.email} label={t('team.fieldEmail')} canEdit={canEditPeople} validate={(v) => (v.includes('@') ? null : t('team.invalidEmail'))} onSave={(v) => change('email', v)} displayClassName="break-words text-xs text-muted" render={withBreaks} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1">
        {canEditPeople && !self ? (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={t('team.roleOf', { name: member.name })} className="inline-flex rounded-full hover:bg-hover">
              <Badge tone={member.role === 'editor' ? 'accent' : 'neutral'}>{roleLabel[member.role]}</Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-32">
              <DropdownMenuRadioGroup value={member.role} onValueChange={(role) => void change('role', role as Role)}>
                <DropdownMenuRadioItem value="member">{roleLabel.member}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="editor">{roleLabel.editor}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge tone={member.role === 'editor' ? 'accent' : 'neutral'}>{roleLabel[member.role]}</Badge>
        )}
        {/* Active is the normal state and has no tag: only the exception is marked (J1-A-41). */}
        {!member.active && <Badge tone="outline">{t('team.inactive')}</Badge>}
        <span className="text-xs text-muted" title={t(LANGUAGE_KEY[member.language])}>
          {t('team.languageOf', { code: t(SHORT_LANGUAGE_KEY[member.language]) })}
        </span>
      </div>
      <div className="min-w-0 text-xs">
        <EditableText value={member.profile ?? ''} label={t('team.profileOf', { name: member.name })} multiline prose canEdit={self} placeholder={t('team.noProfile')} validate={(v) => (v.length > PROFILE_MAX ? t('form.maxLength', { n: PROFILE_MAX }) : null)} onSave={(v) => change('profile', v)} />
      </div>
      <div className="flex min-w-0 flex-col items-end gap-1">
        {canEditPeople && !self && (
          <Button size="sm" onClick={() => void toggleActive()} aria-label={member.active ? t('team.deactivateOf', { name: member.name }) : t('team.reactivateOf', { name: member.name })}>
            {member.active ? t('team.deactivate') : t('team.reactivate')}
          </Button>
        )}
        {problem && (
          <span role="alert" className="text-right text-xs text-danger">
            {problem}
          </span>
        )}
      </div>
    </div>
  )
}
