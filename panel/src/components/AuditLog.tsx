import { useState } from 'react'
import { LoadState } from '@/components/LoadState'
import { NativeSelect } from '@/components/NativeSelect'
import { PageControls } from '@/components/PageControls'
import { SettingsBox } from '@/components/SettingsBox'
import { useLookups } from '@/components/lookups'
import { useFormat, useI18n, type MessageKey } from '@/i18n'
import { EXECUTE_MODELS } from '@team-platform/client'
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

const MEMBER_KEYS = ['to', 'member', 'author_id', 'sent_by_id', 'recipient_ids']
const FIELD_KEYS = ['fields', 'fieldValues']
const STATES = ['queued', 'running', 'done', 'failed']

/** «Auditoría» of Configuración (UD-251, Editor): the log of changes, newest first, filtered by action and paged by the server. */
export function AuditLog() {
  const { t } = useI18n()
  return (
    <SettingsBox fold data-audit title={t('audit.title')}>
      <AuditBody />
    </SettingsBox>
  )
}

/** The log is read when the section is opened: the folded row asks the server for nothing. */
function AuditBody() {
  const { t, has } = useI18n()
  const format = useFormat()
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const log = useAuditLog(page, PAGE_SIZE, action)
  const rows = log.data?.items ?? []
  const { memberName, areaTitle } = useLookups()
  const key = (prefix: string, name: string) => `${prefix}.${name}` as MessageKey
  /** The action as a person says it; one the panel does not know is a generic «Cambio», never the code of the server. */
  const actionOf = (e: AuditEntry) => t(has(key('audit.a', e.action)) ? key('audit.a', e.action) : 'audit.a.other')
  const objectOf = (e: AuditEntry) => {
    const entity = has(key('audit.e', e.entity)) ? t(key('audit.e', e.entity)) : ''
    if (!e.entity_id) return entity
    const named = e.entity === 'member' ? memberName(e.entity_id) : e.entity === 'area' ? areaTitle(e.entity_id) : ''
    return named ? `${entity} ${named}` : `${entity} #${e.entity_id}`
  }
  /** One value of the detail as a person reads it; empty when it is an internal identifier. */
  const valueOf = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return ''
    if (typeof v === 'boolean') return t(v ? 'audit.yes' : 'audit.no')
    if (Array.isArray(v)) return v.map((x) => valueOf(k, x)).filter(Boolean).join(', ')
    const text = String(v)
    if (MEMBER_KEYS.includes(k)) return memberName(text) || (k === 'to' ? modelOf(text) : '')
    if (FIELD_KEYS.includes(k)) return has(key('audit.d', text)) ? t(key('audit.d', text)) : ''
    if (k === 'state' && STATES.includes(text)) return t(key('timing.state', text))
    if (k === 'from' || k === 'to') return modelOf(text)
    return text
  }
  const modelOf = (id: string) => EXECUTE_MODELS.find((m) => m.id === id)?.label ?? ''
  const detailOf = (e: AuditEntry) =>
    Object.entries(e.detail ?? {})
      .filter(([k]) => has(key('audit.d', k)))
      .map(([k, v]) => [t(key('audit.d', k)), valueOf(k, v)] as const)
      .filter(([, value]) => value)
      .map(([label, value]) => `${label}: ${value}`)
      .join(' · ')
  return (
    <>
      <div className="w-56 max-w-full">
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
              {has(key('audit.a', a)) ? t(key('audit.a', a)) : a}
            </option>
          ))}
        </NativeSelect>
      </div>
      {/* «Sin registros» only when the log answered empty: a failed or pending read draws its own state, never the empty line. */}
      {!log.data ? (
        <LoadState query={log} />
      ) : rows.length === 0 ? (
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
                <span className="min-w-0 break-words font-medium">{e.member_id ? (memberName(e.member_id) || e.member_name) : (e.member_name ?? t('audit.system'))}</span>
                <span className="tabular-nums text-muted">{format.stamp(e.at)}</span>
                <span className="min-w-0 break-words leading-5">{actionOf(e)}</span>
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
    </>
  )
}
