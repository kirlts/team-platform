import { mergeConfig } from 'vite'
import base from './vite.config.ts'
const cfg = typeof base === 'function' ? base({ command: 'build', mode: 'production' }) : base
export default mergeConfig(cfg, { build: { outDir: '/home/kirlts/.cache/claude-tmp/dist-analyze', emptyOutDir: true }, plugins: [{ name: 'size', generateBundle(_, b) {
  for (const [f, c] of Object.entries(b)) if (c.type === 'chunk') {
    const g = {}
    for (const [id, m] of Object.entries(c.modules)) { const mm = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/); const k = mm ? mm[1] : id.includes('packages/client') ? 'client' : 'panel-src'; g[k] = (g[k] ?? 0) + m.renderedLength }
    for (const [id, m] of Object.entries(c.modules)) if (!id.includes('node_modules') && m.renderedLength > 6000) console.log('  ', (m.renderedLength/1024).toFixed(0)+'k', id.replace(/.*panel\//,'').replace(/.*packages\//,'pk/'));
    console.log(f, c.code.length, Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}:${(v/1024).toFixed(0)}k`).join(' '))
  } } }] })
