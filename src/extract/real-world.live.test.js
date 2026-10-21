// H-22: a real PDF of a real publisher and real pages downloaded from the internet go through the extractors.
// It needs the network, so it is skipped unless TEAM_LIVE_NETWORK=1:
//   TEAM_LIVE_NETWORK=1 node --test src/extract/real-world.live.test.js
import assert from 'node:assert/strict'
import { stat, writeFile } from 'node:fs/promises'
import { after, test } from 'node:test'
import { extract } from './index.js'
import { makeTmp } from './test/helpers.js'

const live = process.env.TEAM_LIVE_NETWORK === '1'
const tmp = await makeTmp('real-world')
after(() => tmp.cleanup())
const vision = { name: 'none', model: 'none', describe: async () => { throw new Error('the vision provider must not be called') } }

test('a real 15-page paper PDF downloaded from arXiv gives its text, page by page, without vision', { skip: !live, timeout: 120_000 }, async () => {
  const res = await fetch('https://arxiv.org/pdf/1706.03762', { redirect: 'follow' })
  assert.equal(res.status, 200)
  const path = tmp.join('paper.pdf')
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  const { text, meta } = await extract({ id: 'a', kind: 'document', path, mime: 'application/pdf', size: (await stat(path)).size }, { providers: { vision } })
  assert.equal(meta.pageCount, 15)
  assert.equal(meta.scanned, false)
  assert.match(text, /## Página 1\b/)
  assert.match(text, /Attention/)
})

test('a real page downloaded from the internet is read as a link', { skip: !live, timeout: 60_000 }, async () => {
  const { text, meta } = await extract({ id: 'l', kind: 'link', path: 'https://en.wikipedia.org/wiki/Server-sent_events', mime: '', size: 0 }, { providers: { vision } })
  assert.equal(meta.status, 200)
  assert.equal(meta.readable, true)
  assert.match(text, /Server-sent events/i)
})
