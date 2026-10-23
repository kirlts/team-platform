// Spans of what the unattended session does (UD-262). The NDJSON of `claude -p --output-format stream-json` pairs each
// `tool_use` block (assistant event) with its `tool_result` block (user event) by id; the span of a tool opens on the
// first and closes on the second, so its duration is what the session waited for. A `Task`/`Agent` call is a subagent
// span, and the tools its subagent runs (events with `parent_tool_use_id`) hang from it. One `execute.turn` event per
// model message, on the span of the run, carries tokens and the estimated cost.

import { context, trace } from '@opentelemetry/api'
import { clockMs, endManualSpan, startManualSpan } from '../telemetry/api.js'
import { estimateCostUsd } from '../telemetry/pricing.js'
import { phraseForTool } from './stream.js'

const SUBAGENT_TOOLS = new Set(['Task', 'Agent'])
/** Milliseconds during which at least one call was running (calls that overlap count once). */
export function unionMs (intervals) {
  let total = 0
  let end = -Infinity
  for (const { startedAt, endedAt } of [...intervals].sort((a, b) => a.startedAt - b.startedAt)) {
    if (startedAt > end) { total += endedAt - startedAt; end = endedAt } else if (endedAt > end) { total += endedAt - end; end = endedAt }
  }
  return Math.round(total)
}
const blocks = (event) => (Array.isArray(event.message?.content) ? event.message.content : [])

/**
 * @param {{ model: string, clock?: () => number }} options
 * `parentContext` is the context whose active span is the run of the session (defaults to the active one).
 */
export function createSessionTracer ({ model, parentContext = context.active(), clock = clockMs }) {
  const open = new Map() // tool_use id → { span, ctx, subagent }
  const turns = new Map() // message id → { usage, subagent, at }
  const summary = { tools: 0, subagents: 0, failed: 0 }
  const rows = [] // one per finished tool or subagent call, for `execute_runs` (UD-262)

  function onToolUse (event, block) {
    const parent = event.parent_tool_use_id ? (open.get(event.parent_tool_use_id)?.ctx ?? parentContext) : parentContext
    const subagent = SUBAGENT_TOOLS.has(block.name)
    const input = block.input ?? {}
    const span = subagent
      ? startManualSpan('execute.subagent', {
        'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': input.subagent_type ?? 'general-purpose',
        'gen_ai.tool.call.id': block.id, 'team.tool.summary': phraseForTool(block.name, input)
      }, parent, { startTime: clock() })
      : startManualSpan('execute.tool', {
        'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': block.name, 'gen_ai.tool.call.id': block.id,
        'team.tool.summary': phraseForTool(block.name, input), 'team.in_subagent': Boolean(event.parent_tool_use_id)
      }, parent, { startTime: clock() })
    summary[subagent ? 'subagents' : 'tools'] += 1
    open.set(block.id ?? `anon-${open.size}`, {
      span, ctx: trace.setSpan(parent, span), subagent, startedAt: clock(),
      name: subagent ? (input.subagent_type ?? 'general-purpose') : block.name, summary: phraseForTool(block.name, input)
    })
  }

  function onToolResult (block) {
    const entry = open.get(block.tool_use_id)
    if (!entry) return
    open.delete(block.tool_use_id)
    const failed = block.is_error === true
    entry.span.setAttribute('team.tool.success', !failed)
    if (failed) summary.failed += 1
    const endedAt = clock()
    rows.push({ kind: entry.subagent ? 'subagent' : 'tool', name: entry.name, summary: entry.summary, duration_ms: Math.round(endedAt - entry.startedAt), success: !failed, startedAt: entry.startedAt, endedAt })
    endManualSpan(entry.span, { endTime: endedAt, error: failed ? Object.assign(new Error(String(typeof block.content === 'string' ? block.content : 'tool error').slice(0, 200)), { code: 'tool_error' }) : null })
  }

  function onEvent (event) {
    if (event.type === 'assistant') {
      const id = event.message?.id ?? `turn-${turns.size}`
      const usage = event.message?.usage
      const previous = turns.get(id)
      turns.set(id, { usage: usage ?? previous?.usage ?? null, subagent: Boolean(event.parent_tool_use_id), at: previous?.at ?? clock() })
      for (const b of blocks(event)) if (b?.type === 'tool_use') onToolUse(event, b)
    } else if (event.type === 'user') {
      for (const b of blocks(event)) if (b?.type === 'tool_result') onToolResult(b)
    }
  }

  /** Closes what is still open (the session died mid-tool) and writes the turn events on the span of the run. */
  function finish (runSpan) {
    for (const { span, subagent, name, summary: text, startedAt } of open.values()) {
      span.setAttribute('team.tool.success', false)
      span.setAttribute('team.tool.unfinished', true)
      const endedAt = clock()
      rows.push({ kind: subagent ? 'subagent' : 'tool', name, summary: text, duration_ms: Math.round(endedAt - startedAt), success: false, startedAt, endedAt })
      endManualSpan(span, { endTime: endedAt })
    }
    open.clear()
    let n = 0
    const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }
    for (const { usage, subagent, at } of turns.values()) {
      n += 1
      const u = usage ?? {}
      totals.input_tokens += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      totals.output_tokens += u.output_tokens ?? 0
      totals.cache_read_tokens += u.cache_read_input_tokens ?? 0
      totals.cache_write_tokens += u.cache_creation_input_tokens ?? 0
      const tokens = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cached_tokens: u.cache_read_input_tokens ?? 0, cache_creation_tokens: u.cache_creation_input_tokens ?? 0 }
      const cost = usage ? estimateCostUsd({ provider: 'anthropic', model, usage: tokens }) : null
      runSpan?.addEvent('execute.turn', {
        'team.turn.index': n, 'team.turn.subagent': subagent,
        'gen_ai.usage.input_tokens': tokens.input_tokens + tokens.cached_tokens + tokens.cache_creation_tokens,
        'gen_ai.usage.output_tokens': tokens.output_tokens,
        'gen_ai.usage.cache_read.input_tokens': tokens.cached_tokens,
        'gen_ai.usage.cache_write.input_tokens': tokens.cache_creation_tokens,
        ...(cost === null ? {} : { 'team.turn.cost_usd': cost })
      }, at)
    }
    runSpan?.setAttributes({ 'team.tool_calls': summary.tools, 'team.subagent_calls': summary.subagents, 'team.tool_failures': summary.failed, 'team.model_messages': turns.size })
    return { ...summary, turns: turns.size, ...totals, tools_ms: unionMs(rows.filter((r) => r.kind === 'tool')), slowest: rows.map(({ startedAt, endedAt, ...row }) => row).sort((a, b) => b.duration_ms - a.duration_ms) }
  }

  return { onEvent, finish }
}
