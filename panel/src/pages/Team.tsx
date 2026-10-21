import { Avatar } from '@/components/Avatar'
import { EditableTags } from '@/components/EditableTags'
import { EditableText } from '@/components/EditableText'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useMe, useMembers, useSaveMember } from '@/lib/queries'
import type { Member, Role } from '@/lib/types'

const ROLE_LABEL: Record<Role, string> = { member: 'Miembro', editor: 'Editor' }

/** Miembros con sus responsabilidades y dominios. Cada uno edita lo suyo; el Editor puede cambiar el rol de los demás. */
export function Team() {
  const me = useMe().data
  const members = useMembers()

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-4 md:p-6">
      <h1 className="text-xl font-semibold">Equipo</h1>
      <div className="overflow-hidden rounded-lg border border-line">
        <div className="hidden grid-cols-[minmax(11rem,1fr)_6.5rem_minmax(0,2fr)_minmax(0,1.4fr)] gap-4 border-b border-line bg-surface px-3 py-1.5 text-xs font-medium text-muted md:grid">
          <span>Miembro</span>
          <span>Rol</span>
          <span>Responsabilidades</span>
          <span>Dominios</span>
        </div>
        {members.isPending ? (
          <p className="px-3 py-8 text-center text-sm text-muted">Cargando</p>
        ) : (
          (members.data ?? []).map((m) => <MemberRow key={m.id} member={m} self={m.id === me?.id} viewerIsEditor={me?.role === 'editor'} />)
        )}
      </div>
    </div>
  )
}

function MemberRow({ member, self, viewerIsEditor }: { member: Member; self: boolean; viewerIsEditor: boolean }) {
  const save = useSaveMember()
  const canEdit = self
  const patch = (p: Parameters<typeof save.mutateAsync>[0]['patch']) => save.mutateAsync({ id: member.id, self, patch: p })

  return (
    <div className="grid gap-x-4 gap-y-2 border-b border-line px-3 py-3 last:border-b-0 md:grid-cols-[minmax(11rem,1fr)_6.5rem_minmax(0,2fr)_minmax(0,1.4fr)]">
      <div className="flex min-w-0 items-center gap-2.5">
        <Avatar name={member.name} size={30} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {member.name} {self && <Badge tone="accent">Yo</Badge>}
          </p>
          <p className="truncate text-xs text-muted">{member.email}</p>
        </div>
      </div>
      <div className="flex items-start md:pt-1">
        {viewerIsEditor && !self ? (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={`Rol de ${member.name}`} className="rounded-sm hover:bg-hover">
              <Badge tone={member.role === 'editor' ? 'accent' : 'neutral'}>{ROLE_LABEL[member.role]}</Badge>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-32">
              <DropdownMenuRadioGroup value={member.role} onValueChange={(role) => void patch({ role: role as Role })}>
                <DropdownMenuRadioItem value="member">Miembro</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="editor">Editor</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge tone={member.role === 'editor' ? 'accent' : 'neutral'}>{ROLE_LABEL[member.role]}</Badge>
        )}
      </div>
      <div className="min-w-0 text-[13px]">
        <EditableText
          value={member.responsibilities}
          label={`Responsabilidades de ${member.name}`}
          multiline
          rows={2}
          canEdit={canEdit}
          placeholder="Sin responsabilidades"
          onSave={(responsibilities) => patch({ responsibilities })}
        />
      </div>
      <div className="min-w-0 text-[13px]">
        <EditableTags
          values={member.domains}
          label={`Dominios de ${member.name}`}
          canEdit={canEdit}
          placeholder="Sin dominios"
          onSave={(domains) => patch({ domains })}
        />
      </div>
    </div>
  )
}
