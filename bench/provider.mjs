// promptfoo provider: runs the real analyzer (src/analyze) on a bench case and returns
// the result as JSON. config.providers = "fake" uses fake providers with the reference
// (config.mode: perfect | noisy); "real" uses the providers of src/providers/index.js from the environment.
import { loadCases, loadFixtures, runCase } from './lib.js';
import { createBenchProviders } from './fake-providers.js';
import { analyze } from '../src/analyze/index.js';
import { createProviders } from '../src/providers/index.js';

export default class TeamPlatformAnalyzer {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.providerId = options.id ?? 'team-platform-analyzer';
    this.cases = new Map(loadCases().map((c) => [c.id, c]));
    this.fixturesPromise = loadFixtures();
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    const testCase = this.cases.get(context?.vars?.case);
    if (!testCase) return { error: `Unknown case: ${context?.vars?.case}` };
    const providers =
      (this.config.providers ?? 'fake') === 'fake'
        ? createBenchProviders({ expected: testCase.expected, mode: this.config.mode ?? 'perfect', latencyMs: this.config.latencyMs ?? 0 })
        : createProviders(process.env);
    try {
      const run = await runCase({
        analyze,
        providers,
        testCase,
        fixtures: await this.fixturesPromise,
        options: this.config.analyzer ? { analyzer: this.config.analyzer } : {},
      });
      return {
        output: JSON.stringify({ status: run.status, proposal: run.proposal ?? run.draft, units: run.units }),
        latencyMs: run.total_ms,
        cost: run.usage.cost_usd ?? 0,
        tokenUsage: {
          prompt: run.usage.input_tokens,
          completion: run.usage.output_tokens,
          total: run.usage.input_tokens + run.usage.output_tokens,
          cached: run.usage.cached_tokens,
        },
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}
