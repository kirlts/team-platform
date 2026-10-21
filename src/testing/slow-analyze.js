// Fake analyzer for the process shutdown test: it does not finish until it is aborted.
export const analyze = (bundle, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')))
})
