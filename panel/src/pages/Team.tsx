import { UserPlus } from '@/components/icons'
import { useMemo, useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { EditableTags } from '@/components/EditableTags'
import { EditableText } from '@/components/EditableText'
import { FitList } from '@/components/FitList'
import { FormDialog } from '@/components/FormDialog'
import { Page } from '@/components/Page'
import { PageHeader } from '@/components/PageHeader'
import { UndoButtons } from '@/components/UndoButtons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useErrorText, useT } from '@/i18n'
import { useCreateMember, useMe, useMembers, useSaveMember } from '@/lib/queries'
import type { Member, Role } from '@/lib/types'
import { UndoProvider, useUndo, useUndoStack } from '@/lib/undo'

const COLUMNS = 'md:grid-cols-[minmax(14rem,1.3fr)_6.5rem_minmax(0,2fr)_minmax(0,1.4fr)_6.5rem]'

/** Miembros con sus responsabilidades y dominios. Cada uno edita lo suyo; el Editor da de alta, y cambia nombre, correo y rol de los demás. */
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
                <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
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
            <div className={`hidden gap-4 border-b border-line bg-[linear-gradient(180deg,var(--color-chrome-1),var(--color-chrome-2))] px-4 py-2 text-[13px] font-semibold text-muted md:grid ${COLUMNS}`}>
              <span>{t('team.member')}</span>
              <span>{t('team.role')}</span>
              <span>{t('team.responsibilities')}</span>
              <span>{t('team.domains')}</span>
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
  const roleLabel: Record<Role, string> = { member: t('team.roleMember'), editor: t('team.roleEditor') }
  const canEditOwn = self
  const canEditPeople = viewerIsEditor

  /** Cada guardado es una operación que se deshace con el valor anterior. */
  const change = <K extends 'responsibilities' | 'domains' | 'role' | 'name' | 'email' | 'active'>(key: K, next: Member[K]) => {
    const prev = member[key]
    const apply = (value: Member[K]) => save.mutateAsync({ id: member.id, self: self && (key === 'responsibilities' || key === 'domains'), patch: { [key]: value } })
    return undo.run({ label: t('team.edited'), redo: () => apply(next), undo: () => apply(prev) })
  }
  /** Desactivar o reactivar se deshace con el gesto contrario; la API se niega si es uno mismo o el último Editor. */
  const toggleActive = () => change('active', !member.active).then(() => setProblem(null), (err) => setProblem(errorText(err)))
  const required = (v: string) => (v ? null : t('common.required'))
  const errorText = useErrorText()
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <div className={`grid items-start gap-x-4 gap-y-2 border-b border-line px-4 py-3 last:border-b-0 ${COLUMNS} ${member.active ? '' : 'bg-closed-bg/30'}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <Avatar name={member.name} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <EditableText value={member.name} label={t('team.fieldName')} canEdit={canEditPeople} validate={required} onSave={(v) => change('name', v)} displayClassName="text-sm font-semibold" className="w-auto" />
            {self && <Badge tone="accent">{t('team.me')}</Badge>}
            {!member.active && <Badge tone="outline">{t('team.inactive')}</Badge>}
          </div>
          <EditableText value={member.email} label={t('team.fieldEmail')} canEdit={canEditPeople} validate={(v) => (v.includes('@') ? null : t('team.invalidEmail'))} onSave={(v) => change('email', v)} displayClassName="break-all text-xs text-muted" />
        </div>
      </div>
      <div className="flex items-start">
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
      </div>
      <div className="min-w-0 text-[13px]">
        <EditableText value={member.responsibilities} label={t('team.responsibilitiesOf', { name: member.name })} multiline canEdit={canEditOwn} placeholder={t('team.noResponsibilities')} onSave={(v) => change('responsibilities', v)} />
      </div>
      <div className="min-w-0 text-[13px]">
        <EditableTags values={member.domains} label={t('team.domainsOf', { name: member.name })} canEdit={canEditOwn} placeholder={t('team.noDomains')} onSave={(v) => change('domains', v)} />
      </div>
      <div className="flex min-w-0 flex-col items-end gap-1">
        {canEditPeople && !self && (
          <Button size="sm" variant="ghost" className="text-muted" onClick={() => void toggleActive()} aria-label={member.active ? t('team.deactivateOf', { name: member.name }) : t('team.reactivateOf', { name: member.name })}>
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
