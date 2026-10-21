// Proveedor de promptfoo: ejecuta el analizador sobre un caso del banco y devuelve la propuesta como JSON.
// config.analyzer = "fake" usa el analizador falso (config.mode: perfect | noisy);
// cualquier otro valor es la ruta de un módulo que exporta analyze(bundle, { onProgress, onCall }).
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCases, loadFixtures, buildBundle } from './lib.js';
import { createFakeAnalyze } from './fake-analyzer.js';

const here = dirname(fileURLToPath(import.meta.url));

export default class TeamPlatformAnalyzer {
  constructor(options = {}) {
    this.config = options.config ?? {};
    this.providerId = options.id ?? 'team-platform-analyzer';
    this.cases = new Map(loadCases().map((c) => [c.id, c]));
    this.fixtures = loadFixtures();
  }

  id() {
    return this.providerId;
  }

  async callApi(_prompt, context) {
    const testCase = this.cases.get(context?.vars?.case);
    if (!testCase) return { error: `Caso desconocido: ${context?.vars?.case}` };

    let analyze;
    if (this.config.analyzer === 'fake' || this.config.analyzer === undefined) {
      analyze = createFakeAnalyze({ expected: testCase.expected, mode: this.config.mode ?? 'perfect', latencyMs: this.config.latencyMs ?? 0 });
    } else {
      const mod = await import(pathToFileURL(resolve(here, this.config.analyzer)).href);
      analyze = mod.analyze ?? mod.default;
    }

    const calls = [];
    const startedAt = performance.now();
    try {
      const proposal = await analyze(buildBundle(testCase.input, this.fixtures), { onProgress: () => {}, onCall: (c) => calls.push(c) });
      const sum = (key) => calls.reduce((acc, c) => acc + (c[key] ?? 0), 0);
      return {
        output: JSON.stringify(proposal),
        latencyMs: performance.now() - startedAt,
        cost: sum('cost_usd'),
        tokenUsage: {
          prompt: sum('input_tokens'),
          completion: sum('output_tokens'),
          total: sum('input_tokens') + sum('output_tokens'),
          cached: sum('cached_tokens'),
        },
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}
