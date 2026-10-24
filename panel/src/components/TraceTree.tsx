import { useErrorText, useT } from '@/i18n'
import { TeamApiError, type SpanNode } from '@team-platform/client'
import { useJobTrace } from '@team-platform/client/react'

const IN = 'gen_ai.usage.input_tokens'
const OUT = 'gen_ai.usage.output_tokens'
const COST = ['team', 'cost_usd'].join('.')

const duration = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${Math.round(ms / 100) / 10} s`)
const usd = (n: number) => `US$ ${n.toFixed(4)}`

/** Span tree of one job (GET /jobs/:id/trace): duration on every span, tokens and cost on the provider calls. */
export function TraceTree({ jobId }: { jobId: string }) {
  const t = useT()
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
    [t('trace.input'), totals.input_tokens.toLocaleString()],
    [t('trace.output'), totals.output_tokens.toLocaleString()],
    [t('trace.cost'), totals.cost_usd === null ? '—' : usd(totals.cost_usd)],
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
        <Node key={node.span_id} node={node} depth={0} />
      ))}
    </ul>
  )
}

function Node({ node, depth }: { node: SpanNode; depth: number }) {
  const t = useT()
  const input = node.attributes[IN]
  const output = node.attributes[OUT]
  const cost = node.attributes[COST]
  const failed = node.status === 'error'
  return (
    <li>
      <div data-span={node.name} style={{ paddingLeft: depth * 16 }} className="flex flex-wrap items-baseline gap-x-3">
        <span className={failed ? 'font-medium text-danger' : ''}>{node.name}</span>
        <span className="tabular-nums text-muted">{duration(node.duration_ms)}</span>
        {typeof input === 'number' && (
          <span className="tabular-nums text-muted">
            {t('trace.input')} {input.toLocaleString()} · {t('trace.output')} {Number(output ?? 0).toLocaleString()}
          </span>
        )}
        {typeof cost === 'number' && <span className="tabular-nums text-muted">{usd(cost)}</span>}
        {failed && <span className="text-danger">{t('queue.status.failed')}</span>}
      </div>
      {node.children.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <Node key={child.span_id} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}
