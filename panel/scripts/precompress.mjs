// After `vite build`: leaves next to each text asset of dist/ its Brotli (.br) and gzip (.gz) copy, so the server sends the
// one the browser accepts without compressing anything on a request (`preCompressed` of @fastify/static, src/api/index.js).
// Build time has no deadline, so Brotli goes to its maximum quality (11) and gzip to 9. A copy that is not smaller is not kept.
// index.html is not compressed here: the server rewrites it on every request (src/api/mount.js).
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const TEXT = /\.(js|css|svg|json|map|txt)$/

function walk (dir) {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

let kept = 0
for (const file of walk(dist).filter((f) => TEXT.test(f))) {
  const body = readFileSync(file)
  const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
  const gz = gzipSync(body, { level: 9 })
  if (br.length < body.length) { writeFileSync(`${file}.br`, br); kept++ }
  if (gz.length < body.length) { writeFileSync(`${file}.gz`, gz); kept++ }
  console.log(`${path.relative(dist, file)}: ${body.length} B, br ${br.length} B, gzip ${gz.length} B`)
}
console.log(`${kept} compressed copies written`)
