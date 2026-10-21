// Fake analyzer and extractor to run the whole server without keys (manual verification and panel
// smoke test): ANALYZE_MODULE and EXTRACT_MODULE point to this file. Test support only.
export { fakeAnalyze as analyze, fakeExtract as extract } from './helpers.js'
