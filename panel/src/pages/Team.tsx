import { ChevronDown, UserPlus, MoreVertical } from '@/components/icons'
import { useMemo, useRef, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { EditableText } from '@/components/EditableText'
import { EmptyState } from '@/components/EmptyState'
import { FitList } from '@/components/FitList'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { FormDialog } from '@/components/FormDialog'
import { LoadState } from '@/components/LoadState'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { UndoButtons } from '@/components/UndoButtons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useErrorText, useT } from '@/i18n'
import { useNotices } from '@/lib/notices'
import type { Member, Role } from '@team-platform/client'
import { useCreateMember, useDeleteMember, useMe, useMembers, useSaveMember, useSetMemberPassword } from '@team-platform/client/react'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'

/** Maximum length of the profile the API accepts (UD-023). */
const PROFILE_MAX = 4000
/** Identity, profile extract, actions. A name, an address or an extract that does not fit takes another line: nothing in a row is cut (UD-016, «Grilla» rule 5; UD-241 only amends the cards of the message lists). */
const COLUMNS = 'lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_7.5rem]'

/** Members with their responsibilities and domains. Each one edits their own; any person adds, and changes name, email and role of the others; the Editor also writes the profile of an agent. */
export function Team() {
  const t = useT()
  const me = useMe().data
  const members = useMembers()
  const create = useCreateMember()
  const undo = useUndoStack()
  const [adding, setAdding] = useState(false)
  const editor = me?.role === 'editor'
  const rows = useMemo(() => (members.data ?? []).filter((m) => !m.removed), [members.data])

  return (
    <UndoProvider stack={undo}>
      <Page cols={12}>
        <PageHeader
          reserve
          title={t('nav.team')}
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <UndoButtons stack={undo} compact />
              {me && (
                <Button variant="primary" size="lg" onClick={() => setAdding(true)}>
                  <UserPlus size={16} aria-hidden /> {t('team.add')}
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
            <div className={`rotulo hidden h-8 items-center gap-4 border-b border-line px-4 lg:grid ${COLUMNS}`}>
              <span>{t('team.member')}</span>
              <span>{t('team.profile')}</span>
              <span />
            </div>
          }
          renderRow={(m) => <MemberRow member={m} self={m.id === me?.id} viewerIsEditor={editor} />}
          empty={members.isPending || members.isError ? <LoadState query={members} /> : <EmptyState>{t('team.none')}</EmptyState>}
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

function MemberRow({ member, self, viewerIsEditor }: { member: Member; self: boolean; viewerIsEditor: boolean }) {
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
  /** The whole profile, open in a window over the list: the row keeps its height and the list its page. */
  const [profileOpen, setProfileOpen] = useState(false)
  const roleLabel: Record<Role, string> = { member: t('team.roleMember'), editor: t('team.roleEditor') }
  /** What each role allows (UD-007), said on hover and to a screen reader and not as visible text: Equipo has no help text by default. */
  const roleHint: Record<Role, string> = { member: t('team.roleMemberHint'), editor: t('team.roleEditorHint') }
  /** Set when the menu item opens the password field: the menu must not take the focus back from it. */
  const openedPassword = useRef(false)

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
  /** «Eliminar» deletes at once (UD-253, no step that confirms it): what the member published stays under «Miembro eliminado» (UD-292); the notice says how much stays. */
  const deleteMember = async () => {
    setProblem(null)
    try {
      const r = await remove.mutateAsync({ id: member.id })
      const k = r.kept ?? { inputs: 0, messages: 0, replies: 0 }
      notices.show({ text: k.messages || k.replies ? t('team.deletedWithHistory', { name: member.name, ...k }) : t('team.deletedDone', { name: member.name }) })
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

  const canEditProfile = self || viewerIsEditor // UD-288, UD-287: the Editor writes the profile of any member
  const profile = member.profile ?? ''
  const paragraphs = profile.split(/\n\s*\n/).filter((x) => x.trim())
  const extract = (paragraphs[0] ?? '').replace(/\s+/g, ' ').trim()
  const more = paragraphs.length > 1

  return (
    <div data-member-row className={`grid shrink-0 items-start gap-x-4 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 max-lg:grid-cols-[minmax(0,1fr)_auto] ${COLUMNS}`}>
      <div className="flex min-w-0 items-start gap-3">
        <Avatar name={member.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-2 pointer-coarse:min-h-11">
            <EditableText value={member.name} label={t('team.fieldName')} canEdit validate={required} onSave={(v) => change('name', v)} displayClassName={`text-sm font-semibold leading-snug ${member.active ? '' : 'text-muted'}`} className="block min-w-0 shrink" />
            {member.role === 'editor' && (
              <Badge tone="accent" className="shrink-0" title={roleHint.editor}>
                {roleLabel.editor}
              </Badge>
            )}
            {self && <Badge className="shrink-0">{t('team.me')}</Badge>}
            {/* Active is the normal state and has no tag: only the exception is marked (J1-A-41). */}
            {!member.active && <Badge tone="outline" className="shrink-0">{t('team.inactive')}</Badge>}
          </div>
          <div className="min-h-5 pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
            <EditableText value={member.email} label={t('team.fieldEmail')} canEdit validate={(v) => (v.includes('@') ? null : t('team.invalidEmail'))} onSave={(v) => change('email', v)} displayClassName="break-all text-xs leading-snug text-muted" className="block min-w-0 flex-1" />
          </div>
        </div>
      </div>
      {password !== null ? (
        <form data-password-form className="flex min-w-0 items-center gap-2 max-lg:col-span-2 max-lg:row-start-2" onSubmit={(e) => { e.preventDefault(); void savePassword() }}>
          <Input type="password" autoComplete="new-password" spellCheck={false} autoFocus value={password} onChange={(e) => setPasswordValue(e.target.value)} aria-label={t('team.passwordNew')} placeholder={t('team.passwordNew')} aria-invalid={problem ? true : undefined} className="h-8 min-w-0 flex-1 lg:max-w-64" />
          <Button variant="primary" size="sm" type="submit" disabled={!password || setPassword.isPending}>
            {t('common.save')}
          </Button>
          <Button size="sm" type="button" variant="ghost" disabled={setPassword.isPending} onClick={() => { setPasswordValue(null); setProblem(null) }}>
            {t('common.cancel')}
          </Button>
        </form>
      ) : (
        /* The profile reads as its first paragraph, whole and wrapped; «Ver más» says there is more and the whole text opens in a window over the list, which does not move (Martín, 2026-10-24). */
        <button
          type="button"
          data-profile-extract
          aria-haspopup="dialog"
          aria-label={t('team.profileOf', { name: member.name })}
          onClick={() => setProfileOpen(true)}
          className="-mx-1.5 min-w-0 rounded-md px-1.5 py-1 text-left text-sm hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent max-lg:col-span-2 max-lg:row-start-2 max-lg:ml-[38px] pointer-coarse:min-h-11"
        >
          <span className={`block break-words ${extract ? 'text-fg' : 'text-faint'}`}>
            {extract || t('team.noProfile')}
            {more && <span className="ml-1.5 font-semibold text-accent-deep">{t('team.profileMore')}</span>}
          </span>
        </button>
      )}
      <div className="flex h-11 min-w-0 items-center justify-end max-lg:col-start-2 max-lg:row-start-1">
        {!self && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* On a phone the button is the three dots (its name stays for screen readers): the word took half the row and cut every name. */}
              <Button size="sm" disabled={busy} aria-label={t('team.actionsOf', { name: member.name })} title={t('team.actions')} className="max-sm:w-11 max-sm:px-0">
                <MoreVertical size={18} aria-hidden className="sm:hidden" />
                <span className="max-sm:hidden">{t('team.actions')}</span>
                <ChevronDown size={16} aria-hidden className="max-sm:hidden" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-48"
              onCloseAutoFocus={(e) => {
                if (openedPassword.current) {
                  openedPassword.current = false
                  e.preventDefault()
                }
              }}
            >
              {/* The role changes here: the row only marks the Editor, the exception (Martín, 2026-10-24). */}
              <DropdownMenuLabel>{t('team.role')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup aria-label={t('team.roleOf', { name: member.name })} value={member.role} onValueChange={(role) => void change('role', role as Role, t('team.roleDone', { name: member.name, role: roleLabel[role as Role] }))}>
                <DropdownMenuRadioItem value="member" title={roleHint.member} aria-label={`${roleLabel.member}. ${roleHint.member}`}>
                  {roleLabel.member}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="editor" title={roleHint.editor} aria-label={`${roleLabel.editor}. ${roleHint.editor}`}>
                  {roleLabel.editor}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              {local && password === null && (
                <DropdownMenuItem
                  aria-label={t('team.passwordChangeOf', { name: member.name })}
                  onSelect={() => {
                    openedPassword.current = true
                    setProblem(null)
                    setPasswordValue('')
                  }}
                >
                  {t('team.passwordChange')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem aria-label={member.active ? t('team.deactivateOf', { name: member.name }) : t('team.reactivateOf', { name: member.name })} onSelect={() => void toggleActive()}>
                {member.active ? t('team.deactivate') : t('team.reactivate')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-danger data-[highlighted]:bg-danger-soft data-[highlighted]:text-danger"
                aria-label={t('team.deleteOf', { name: member.name })}
                title={t('team.deleteHint')}
                onSelect={() => void deleteMember()}
              >
                {t('team.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {problem && (
        <span role="alert" className="col-span-full text-sm text-danger">
          {problem}
        </span>
      )}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent title={t('team.profileOf', { name: member.name })} className="max-w-xl">
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 py-4">
            <div className="flex items-center gap-3">
              <Avatar name={member.name} size={36} />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug break-words">{member.name}</p>
                <p className="text-xs leading-snug text-muted break-words">{member.email}</p>
              </div>
            </div>
            <EditableText value={profile} label={t('team.profileOf', { name: member.name })} canEdit={canEditProfile} multiline prose placeholder={t('team.noProfile')} validate={(v) => (v.length > PROFILE_MAX ? t('form.maxLength', { n: PROFILE_MAX }) : null)} onSave={(v) => change('profile', v)} displayClassName="text-sm" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
