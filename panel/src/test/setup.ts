import { beforeEach } from 'vitest'

// jsdom is shared by every file of a worker (vite.config.ts, pool vmThreads): the drafts that a test stores must not reach the next one.
beforeEach(() => {
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
})
