import { UserPlus } from '@/components/icons'
import { useMemo, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { EditableText } from '@/components/EditableText'
import { FitList } from '@/components/FitList'
import { FoldedText } from '@/components/FoldedText'
import { FormDialog } from '@/components/FormDialog'
import { LoadState } from '@/components/LoadState'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { UndoButtons } from '@/components/UndoButtons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useErrorText, useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import { useCreateMember, useDeleteMember, useMe, useMembers, useSaveMember, useSetMemberPassword } from '@/lib/queries'
import type { Member, Role } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'

/** Maximum length of the profile the API accepts (UD-023). */
const PROFILE_MAX = 4000
const COLUMNS = 'md:grid-cols-[15rem_6rem_minmax(0,1fr)_13rem]'

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
  /** The member whose profile is open: the list keeps that row on the visible page, since opening it makes it taller and fewer rows fit. */
  const [opened, setOpened] = useState<string | undefined>()
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
          reveal={opened}
          header={
            <div className={`hidden gap-4 border-b border-line bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-4 py-2 text-sm font-semibold text-muted md:grid ${COLUMNS}`}>
              <span>{t('team.member')}</span>
              <span>{t('team.role')}</span>
              <span>{t('team.profile')}</span>
              <span>{editor ? t('team.actions') : null}</span>
            </div>
          }
          renderRow={(m) => <MemberRow member={m} self={m.id === me?.id} viewerIsEditor={editor} profileOpen={opened === m.id} onProfileOpen={(open) => setOpened(open ? m.id : undefined)} />}
          empty={<LoadState query={members} />}
        />
        <FormDialog
          open={adding}
          onOpenChange={setAdding}
          title={t('team.new')}
          submitLabel={t('common.create')}
          fields={[
            { name: 'name', label: t('team.fieldName'), required: true },
            { name: 'email', label: t('team.fieldEmail'), required: true, type: 'email', autoComplete: 'off' },
            { name: 'password', label: t('team.fieldPassword'), type: 'password', autoComplete: 'new-password', hint: me?.password_min_length ? t('password.min', { n: me.password_min_length }) : undefined },
          ]}
          onSubmit={(v) => create.mutateAsync({ name: v.name, email: v.email, ...(v.password ? { password: v.password } : {}) })}
        />
      </Page>
    </UndoProvider>
  )
}

function MemberRow({ member, self, viewerIsEditor, profileOpen, onProfileOpen }: { member: Member; self: boolean; viewerIsEditor: boolean; profileOpen: boolean; onProfileOpen: (open: boolean) => void }) {
  const t = useT()
  const undo = useUndo()
  const save = useSaveMember()
  const remove = useDeleteMember()
  const notices = useNotices()
  const errorText = useErrorText()
  const setPassword = useSetMemberPassword()
  /** The password typed in the row (null while the field is closed). With external identity the host administers it and the control does not exist. */
  const [password, setPasswordValue] = useState<string | null>(null)
  const local = !useMe().data?.provider?.startsWith('delegated')
  const [problem, setProblem] = useState<string | null>(null)
  const roleLabel: Record<Role, string> = { member: t('team.roleMember'), editor: t('team.roleEditor') }
  /** What each role allows (UD-007), said on hover and to a screen reader and not as visible text: Equipo has no help text by default. */
  const roleHint: Record<Role, string> = { member: t('team.roleMemberHint'), editor: t('team.roleEditorHint') }
  const canEditPeople = viewerIsEditor

  /** Each save is an operation undone with the previous value. */
  const change = <K extends 'profile' | 'role' | 'name' | 'email' | 'active'>(key: K, next: Member[K], announce?: string) => {
    const prev = member[key]
    const apply = (value: Member[K]) => save.mutateAsync({ id: member.id, self: self && key === 'profile', patch: { [key]: value } })
    return undo.run({ label: t('team.edited'), redo: () => apply(next), undo: () => apply(prev) }, announce ? { announce } : undefined)
  }
  const required = (v: string) => (v ? null : t('common.required'))
  /** Deactivating or reactivating is undone with the opposite gesture; the API refuses if it is oneself or the last Editor. */
  const toggleActive = () =>
    change('active', !member.active, member.active ? t('team.deactivatedDone', { name: member.name }) : t('team.reactivatedDone', { name: member.name })).then(
      () => setProblem(null),
      (err) => setProblem(errorText(err)),
    )
  /** «Eliminar» deletes at once with everything of theirs (UD-253): no step that confirms it; the notice says how much went with them. */
  const deleteMember = async () => {
    setProblem(null)
    try {
      const r = await remove.mutateAsync({ id: member.id, purge: true })
      const d = r.deleted ?? { inputs: 0, messages: 0, replies: 0 }
      notices.show({ text: d.inputs || d.messages || d.replies ? t('team.deletedWithHistory', { name: member.name, ...d }) : t('team.deletedDone', { name: member.name }) })
    } catch (err) {
      setProblem(errorText(err))
    }
  }
  const busy = remove.isPending
  const savePassword = async () => {
    try {
      await setPassword.mutateAsync({ id: member.id, password: password ?? '' })
      setPasswordValue(null)
      setProblem(null)
      notices.show({ text: t('team.passwordDone', { name: member.name }) })
    } catch (err) {
      setProblem(errorText(err))
    }
  }

  return (
    <div className={`grid items-start gap-x-4 max-md:gap-x-2 gap-y-2 max-md:grid-cols-[minmax(0,1fr)_auto] border-b border-line px-4 py-3 last:border-b-0 ${COLUMNS} ${member.active ? '' : 'bg-closed-bg/30'}`}>
      <div className="flex min-w-0 items-start gap-2.5 max-md:col-span-2">
        <Avatar name={member.name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <EditableText value={member.name} label={t('team.fieldName')} canEdit={canEditPeople} validate={required} onSave={(v) => change('name', v)} displayClassName="text-sm font-semibold" className="w-auto" />
            {self && <Badge tone="accent">{t('team.me')}</Badge>}
          </div>
          <EditableText value={member.email} label={t('team.fieldEmail')} canEdit={canEditPeople} validate={(v) => (v.includes('@') ? null : t('team.invalidEmail'))} onSave={(v) => change('email', v)} displayClassName="-mb-[5px] break-words pb-[5px] text-xs text-muted" render={withBreaks} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-1 max-md:flex-row max-md:flex-wrap max-md:items-center max-md:gap-x-3 max-md:self-center">
        {canEditPeople && !self ? (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={`${t('team.roleOf', { name: member.name })}: ${roleLabel[member.role]}. ${roleHint[member.role]}`} title={roleHint[member.role]} className="inline-flex rounded-full hover:bg-hover">
              <Badge tone={member.role === 'editor' ? 'accent' : 'neutral'}>{roleLabel[member.role]}</Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-32">
              <DropdownMenuRadioGroup value={member.role} onValueChange={(role) => void change('role', role as Role)}>
                <DropdownMenuRadioItem value="member" title={roleHint.member}>
                  {roleLabel.member}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="editor" title={roleHint.editor}>
                  {roleLabel.editor}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge tone={member.role === 'editor' ? 'accent' : 'neutral'} title={roleHint[member.role]}>
            {roleLabel[member.role]}
          </Badge>
        )}
        {/* Active is the normal state and has no tag: only the exception is marked (J1-A-41). */}
        {!member.active && <Badge tone="outline">{t('team.inactive')}</Badge>}
      </div>
      <div className="min-w-0 text-sm max-md:col-span-2">
        {/* The profile is read in its first paragraph and the rest is one click away, whole and not cut (J3-A-42, UD-016). */}
        <FoldedText value={member.profile ?? ''} label={t('team.profileOf', { name: member.name })} canEdit={self} open={profileOpen} onOpenChange={onProfileOpen} placeholder={t('team.noProfile')} validate={(v) => (v.length > PROFILE_MAX ? t('form.maxLength', { n: PROFILE_MAX }) : null)} onSave={(v) => change('profile', v)} />
      </div>
      {/* On a phone the cell dissolves: the action shares the row of the role, on the right edge, and the failure takes its own row below the profile. */}
      <div className="flex min-w-0 flex-col items-end gap-1 max-md:contents">
        {canEditPeople && !self && (
          <div className="flex flex-wrap justify-end gap-1 max-md:col-start-2 max-md:row-start-2 max-md:self-center max-md:[&>button]:px-1.5">
            <Button size="sm" variant="secondary" className="font-normal hover:border-danger hover:text-danger" disabled={busy} onClick={() => void deleteMember()} aria-label={t('team.deleteOf', { name: member.name })} title={t('team.deleteHint')}>
              {t('team.delete')}
            </Button>
            {local && password === null && (
              <Button size="sm" variant="secondary" className="font-normal" onClick={() => { setProblem(null); setPasswordValue('') }} aria-label={t('team.passwordOf', { name: member.name })}>
                {t('team.password')}
              </Button>
            )}
            <Button size="sm" variant="secondary" className="font-normal hover:border-danger hover:text-danger" disabled={busy} onClick={() => void toggleActive()} aria-label={member.active ? t('team.deactivateOf', { name: member.name }) : t('team.reactivateOf', { name: member.name })}>
              {member.active ? t('team.deactivate') : t('team.reactivate')}
            </Button>
          </div>
        )}
        {problem && (
          <span role="alert" className="text-right text-xs text-danger max-md:col-span-2 max-md:text-left">
            {problem}
          </span>
        )}
      </div>
      {password !== null && (
        <form
          data-password-form
          className="flex flex-wrap items-center justify-end gap-2 col-span-full"
          onSubmit={(e) => { e.preventDefault(); void savePassword() }}
        >
          <Input type="password" autoComplete="new-password" spellCheck={false} autoFocus value={password} onChange={(e) => setPasswordValue(e.target.value)} aria-label={t('team.passwordNew')} placeholder={t('team.passwordNew')} className="w-56" />
          <Button size="sm" type="submit" disabled={!password || setPassword.isPending}>
            {t('common.save')}
          </Button>
          <Button size="sm" type="button" variant="ghost" disabled={setPassword.isPending} onClick={() => { setPasswordValue(null); setProblem(null) }}>
            {t('common.cancel')}
          </Button>
        </form>
      )}
    </div>
  )
}
