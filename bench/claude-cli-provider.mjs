// Text provider that answers through `claude -p` (the subscription of the account that runs it, no API key).
// It lets the real `api` analyzer (classification, split check, decomposition) run with a real model from a session.
// Every call is a fresh process with no tools, no settings, no MCP servers and no session, in an empty directory:
// the model sees the system prompt and the messages of the request, nothing else.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFileSync } from 'node:fs';

const blockText = (b) => (typeof b === 'string' ? b : (b?.text ?? JSON.stringify(b)));
const contentText = (c) => (Array.isArray(c) ? c.map(blockText).join('\n') : blockText(c));

function run(args, prompt, cwd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs); // only the process launched here
    child.stdout.on('data', (c) => out.push(c));
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8'))); } catch (e) { reject(new Error(`claude -p returned no JSON: ${Buffer.concat(out).toString('utf8').slice(0, 300)}`)); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
}

/**
 * @param {{model?: string, spendLog?: string, timeoutMs?: number}} [opts]  `spendLog`: JSONL file, one line per call with its cost.
 * @returns {{text: object}} providers for `analyze` (api analyzer)
 */
export function createClaudeCliProviders({ model = 'claude-haiku-5-5', spendLog, timeoutMs = 300_000 } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'cli-provider-'));
  const text = {
    name: 'claude-cli',
    model,
    schemaProfile: 'anthropic',
    async complete(req) {
      const system = [].concat(req.system ?? []).map(blockText).join('\n\n');
      const prompt = req.messages.map((m) => (req.messages.length > 1 ? `[${m.role}]\n` : '') + contentText(m.content)).join('\n\n');
      const args = ['-p', '--model', model, '--output-format', 'json', '--setting-sources', '', '--strict-mcp-config', '--disable-slash-commands', '--tools', '', '--no-session-persistence', '--system-prompt', system || 'Answer with the JSON the schema asks for.'];
      if (req.effort) args.push('--effort', req.effort);
      if (req.schema) args.push('--json-schema', JSON.stringify(req.schema));
      const r = await run(args, prompt, cwd, timeoutMs);
      if (r.is_error) throw new Error(`claude -p error: ${String(r.result ?? r.subtype).slice(0, 300)}`);
      const u = r.usage ?? {};
      const usage = { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cached_tokens: u.cache_read_input_tokens ?? 0, cache_creation_tokens: u.cache_creation_input_tokens ?? 0 };
      const used = Object.keys(r.modelUsage ?? {}).join(',') || model;
      if (spendLog) appendFileSync(spendLog, `${JSON.stringify({ model: used, usage, cost_usd: r.total_cost_usd ?? null, at: new Date().toISOString() })}\n`);
      const base = { usage, duration_ms: r.duration_ms ?? null, provider: 'claude-cli', model: used };
      if (req.schema) {
        const json = r.structured_output ?? (typeof r.result === 'string' ? JSON.parse(r.result) : null);
        return { ...base, json };
      }
      return { ...base, text: String(r.result ?? '') };
    },
  };
  return { text, textFallback: null, vision: null, speech: null };
}
