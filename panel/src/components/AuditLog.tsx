import { useState } from 'react'
import { NativeSelect } from '@/components/NativeSelect'
import { PageControls } from '@/components/PageControls'
import { SettingsBox } from '@/components/SettingsBox'
import { useFormat, useT } from '@/i18n'
import type { AuditEntry } from '@team-platform/client'
import { useAuditLog } from '@team-platform/client/react'

const PAGE_SIZE = 10
const COLUMNS = 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,2fr)]'
/** The actions the server writes to the log (src/domain/audit.js callers), for the filter. */
const ACTIONS = Object.entries({
  area: ['create', 'delete', 'restore', 'update'],
  data: ['reset'],
  input: ['cancel', 'create', 'delete', 'edit', 'publish', 'reprocess', 'restore'],
  jobs: ['purge'],
  member: ['create', 'delete', 'password', 'update'],
  message: ['close', 'delete', 'reopen', 'reply', 'restore', 'update'],
  reply: ['delete', 'restore'],
  settings: ['connection.add', 'connection.delete', 'project.update', 'providers', 'publication', 'telemetry'],
  template: ['create', 'delete', 'restore', 'update'],
}).flatMap(([entity, verbs]) => verbs.map((verb) => `${entity}.${verb}`))

const objectOf = (e: AuditEntry) => [e.entity, e.entity_id].filter(Boolean).join(' ')
const detailOf = (e: AuditEntry) =>
  e.detail
    ? Object.entries(e.detail)
        .map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(', ') : String(v)}`)
        .join(' · ')
    : ''

/** «Auditoría» of Configuración (UD-251, Editor): the log of changes, newest first, filtered by action and paged by the server. */
export function AuditLog() {
  const t = useT()
  const format = useFormat()
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const log = useAuditLog(page, PAGE_SIZE, action)
  const rows = log.data?.items ?? []
  return (
    <SettingsBox
      data-audit
      title={t('audit.title')}
      aside={
        <div className="w-56">
          <NativeSelect
            aria-label={t('audit.action')}
            value={action}
            onChange={(e) => {
              setAction(e.target.value)
              setPage(1)
            }}
          >
            <option value="">{t('audit.all')}</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </NativeSelect>
        </div>
      }
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{t('audit.empty')}</p>
      ) : (
        <div className="flex flex-col">
          <div aria-hidden className={`rotulo hidden h-8 items-center gap-x-4 border-b border-line md:grid ${COLUMNS}`}>
            <span>{t('audit.who')}</span>
            <span>{t('audit.when')}</span>
            <span>{t('audit.action')}</span>
            <span>{t('audit.object')}</span>
          </div>
          <ul aria-label={t('audit.list')} className="flex flex-col">
            {rows.map((e) => (
              <li key={e.id} data-audit-row={e.action} className={`grid min-h-12 shrink-0 grid-cols-2 items-center gap-x-4 gap-y-0.5 border-b border-line py-2 text-sm last:border-b-0 ${COLUMNS}`}>
                <span className="min-w-0 break-words font-medium">{e.member_name ?? t('audit.system')}</span>
                <span className="tabular-nums text-muted">{format.stamp(e.at)}</span>
                <span className="min-w-0 break-all font-mono leading-5">{e.action}</span>
                <span className="col-span-2 min-w-0 break-words text-muted md:col-span-1">
                  {objectOf(e)}
                  {detailOf(e) && <span className="block">{detailOf(e)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <PageControls page={page} limit={PAGE_SIZE} total={log.data?.total ?? 0} onPage={setPage} />
    </SettingsBox>
  )
}
