import { FailedMark } from '@/components/FailedMark'
import { useToolPhrase } from '@/lib/tool-phrase'
import { useErrorText, useFormat, useI18n, useT, type MessageKey } from '@/i18n'
import { TeamApiError, type SpanNode } from '@team-platform/client'
import { useJobTrace } from '@team-platform/client/react'

const IN = 'gen_ai.usage.input_tokens'
const OUT = 'gen_ai.usage.output_tokens'
const COST = ['team', 'cost_usd'].join('.')
const SUMMARY = ['team', 'tool', 'summary'].join('.')
const ACTION = ['team', 'tool', 'action'].join('.')
const DETAIL = ['team', 'tool', 'detail'].join('.')

/** What a span is called for a person: the step it stands for. A tool or a subagent says what it did (its summary); a name the catalog does not know is read as words, never shown as the dotted identifier. */
function useSpanLabel() {
  const { t, has } = useI18n()
  const toolText = useToolPhrase()
  return (node: SpanNode) => {
    const summary = node.attributes[SUMMARY]
    const str = (v: unknown) => (typeof v === 'string' ? v : null)
    if ((node.name === 'execute.tool' || node.name === 'execute.subagent') && typeof summary === 'string' && summary) return toolText({ action: str(node.attributes[ACTION]), detail: str(node.attributes[DETAIL]), summary, name: node.name })
    if (has(`span.${node.name}`)) return t(`span.${node.name}` as MessageKey)
    const words = node.name.replace(/[._]+/g, ' ').trim()
    return words.charAt(0).toUpperCase() + words.slice(1)
  }
}

/** Span tree of one job (GET /jobs/:id/trace): duration on every span, tokens and cost on the provider calls. */
export function TraceTree({ jobId }: { jobId: string }) {
  const t = useT()
  const { decimal, usd } = useFormat()
  const errorText = useErrorText()
  const trace = useJobTrace(jobId, true)
  if (trace.isPending) return <p className="text-sm text-muted">…</p>
  if (trace.isError) {
    const none = trace.error instanceof TeamApiError && trace.error.status === 404
    return (
      <p data-trace-none={none ? '' : undefined} className={none ? 'text-sm text-muted' : 'break-words text-sm text-danger'}>
        {none ? t('queue.noTrace') : errorText(trace.error)}
      </p>
    )
  }
  const { totals } = trace.data
  const figures: [string, string][] = [
    [t('trace.calls'), String(totals.llm_calls)],
    [t('trace.input'), decimal(totals.input_tokens, 0)],
    [t('trace.output'), decimal(totals.output_tokens, 0)],
    [t('trace.cost'), totals.cost_usd === null ? '—' : usd(totals.cost_usd, 4)],
  ]
  return (
    <div data-trace className="flex flex-col gap-2 rounded-lg bg-hover/50 px-4 py-3 text-sm">
      <dl className="flex flex-wrap gap-x-5 gap-y-0.5">
        {figures.map(([label, value]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="text-muted">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <ul aria-label={t('trace.tree')} className="flex flex-col gap-0.5">
        {trace.data.roots.map((node) => (
          <Node key={node.span_id} node={node} depth={0} />
        ))}
      </ul>
    </div>
  )
}

/** The nodes of a span tree, without the totals: the same rows `TraceTree` draws. */
export function SpanTree({ roots, label }: { roots: SpanNode[]; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col gap-0.5">
      {roots.map((node) => (
        <Node key={node.span_id} node={node} depth={0} sheet />
      ))}
    </ul>
  )
}

/** `sheet`: the tree of the sheet of a message writes money as the rest of the sheet does (cents; four decimals only under one cent), the one of the Cola keeps four. */
function Node({ node, depth, sheet = false }: { node: SpanNode; depth: number; sheet?: boolean }) {
  const t = useT()
  const { decimal, usd, duration } = useFormat()
  const label = useSpanLabel()
  const input = node.attributes[IN]
  const output = node.attributes[OUT]
  const cost = node.attributes[COST]
  const failed = node.status === 'error'
  return (
    <li>
      <div data-span={node.name} style={{ paddingLeft: depth * 16 }} className="flex flex-wrap items-baseline gap-x-3">
        <span className={failed ? 'font-medium text-danger' : ''}>{label(node)}</span>
        <span className="tabular-nums text-muted">{duration(node.duration_ms)}</span>
        {typeof input === 'number' && (
          <span className="tabular-nums text-muted">
            {t('trace.input')} {decimal(input, 0)} · {t('trace.output')} {decimal(Number(output ?? 0), 0)}
          </span>
        )}
        {typeof cost === 'number' && <span className="tabular-nums text-muted">{usd(cost, sheet ? undefined : 4)}</span>}
        {failed && <FailedMark />}
      </div>
      {node.children.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <Node key={child.span_id} node={child} depth={depth + 1} sheet={sheet} />
          ))}
        </ul>
      )}
    </li>
  )
}
