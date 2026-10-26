// The window sizes of fits-one-screen.browser.test.mjs and the shards the runner (scripts/browser-tests.mjs) splits that file into.
export const ALL_SIZES = [
  [1440, 900],
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
]
// FIT_SHARD=<width>x<height> runs only the tests of that window size, and FIT_SHARD=grow only the test of the window that grows: the runner
// (scripts/browser-tests.mjs) starts one process per shard, each with its own server and Chromium, so the file takes as long as its slowest
// shard and not the sum of its four sizes. Without FIT_SHARD the file runs whole, as before.
export const SHARDS = [...ALL_SIZES.map(([w, h]) => `${w}x${h}`), 'grow']
