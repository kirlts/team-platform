// The walkthrough of a proposal (UD-275): a numbered route through the view of a branch, recorded in the session that did the work, with the browser
// the host already has (nothing new is turned on, no extra cost). It writes, in `outDir`:
//   walkthrough-<profile>.webm   the video, VP8 without sound; its size is the viewport (no bars): 1280x720 for desktop, 390x844 for phone
//   step-<n>[-<profile>].png     one screenshot per step, taken after the label is drawn and the touched element is marked
//   steps.json                   [{ n, label, at_ms, profile, video, shot }]: the second of each step in the video
//   captures.json                the `captures` list for the final output of the session (the video and the screenshots), `alt` carrying «0:04 · Paso 2 · …»
// A step is { label, target?, goto?, click?, fill?: [selector, text], press?, timeout? } (`timeout` in ms for the action, Playwright's own default otherwise). `target` is the element that gets the outline (default: the element
// of `click` or `fill`). Before each step the page shows a small fixed label «Paso 2 · <label>» and the outline; the person reviewing quotes «paso 2» or
// the second. Used from `team walkthrough`; `playwright` is loaded from the host (the repository's own dependency), never bundled.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The two sizes of the review (UD-275). Video size = viewport size: Playwright scales a video down to fit 800x800 unless `size` is given (playwright.dev/docs/videos, consulted 2026-10-24). */
export const PROFILES = {
  desktop: { width: 1280, height: 720 },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
}
const LABEL_PAUSE_MS = 900 // declared courtesy: the label and the outline are on screen this long before the step acts, so the video can be read
const SETTLE_PAUSE_MS = 700 // declared courtesy: the result of the step stays on screen this long before the next label

/** «0:04» for 4,300 ms. */
export const clock = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

const OVERLAY_ID = '__team_walkthrough_label'
const MARK_ATTRIBUTE = 'data-team-walkthrough-mark'

/** Draws the fixed label in the top-left corner and outlines `target`. Runs in the page. */
async function annotate (page, text, target) {
  await page.evaluate(({ text, target, id, mark }) => {
    document.getElementById(id)?.remove()
    document.querySelectorAll(`[${mark}]`).forEach((el) => { el.style.outline = el.dataset.teamWalkthroughWas ?? ''; el.removeAttribute(mark) })
    const label = document.createElement('div')
    label.id = id
    label.textContent = text
    label.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;max-width:calc(100vw - 16px);padding:4px 8px;border-radius:4px;background:#111;color:#fff;font:600 14px/1.3 system-ui,sans-serif;pointer-events:none'
    document.body.append(label)
    const el = target ? document.querySelector(target) : null
    if (el) { el.dataset.teamWalkthroughWas = el.style.outline; el.style.outline = '3px solid #ff2d55'; el.setAttribute(mark, '1') }
  }, { text, target, id: OVERLAY_ID, mark: MARK_ATTRIBUTE })
}

/**
 * Records the route once per profile. `playwright` is the module (`import('playwright')`); `launch` overrides how the browser starts (tests).
 * Returns { steps, captures, videos, failed }; `failed` lists the profiles that could not record, each with its reason in one line: the screenshots
 * of the steps that did run are still returned.
 */
export async function recordWalkthrough ({ url, steps, profiles = ['desktop'], outDir, place, as, masked = false, playwright, launch = null, storageState = null }) {
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('walkthrough: at least one step is needed.')
  await mkdir(outDir, { recursive: true })
  const result = { steps: [], captures: [], videos: [], failed: [] }
  const several = profiles.length > 1
  let browser
  try {
    browser = await (launch ? launch() : (playwright.chromium ?? playwright.default.chromium).launch({ headless: true })) // `import()` of a CommonJS package puts the API under `default`
  } catch (error) {
    result.failed.push({ profile: profiles.join(','), reason: `no browser: ${String(error.message).split('\n')[0]}` })
    return result
  }
  try {
    for (const profile of profiles) {
      const size = PROFILES[profile]
      if (!size) throw new Error(`walkthrough: unknown profile «${profile}» (desktop or phone).`)
      const { width, height, ...device } = size
      const context = await browser.newContext({ ...device, viewport: { width, height }, recordVideo: { dir: outDir, size: { width, height } }, ...(storageState ? { storageState } : {}) })
      const page = await context.newPage()
      const started = Date.now()
      const video = page.video()
      const suffix = several ? `-${profile}` : ''
      const mine = []
      try {
        await page.goto(url, { waitUntil: 'load' })
        for (const [index, step] of steps.entries()) {
          const n = index + 1
          if (step.goto) await page.goto(new URL(step.goto, url).href, { waitUntil: 'load' })
          const target = step.target ?? step.click ?? step.fill?.[0] ?? null
          await annotate(page, `Paso ${n} · ${step.label}`, target)
          const at = Date.now() - started
          await page.waitForTimeout(LABEL_PAUSE_MS)
          const shot = `step-${n}${suffix}.png`
          await page.screenshot({ path: join(outDir, shot) })
          if (step.click) await page.click(step.click, step.timeout ? { timeout: step.timeout } : {})
          if (step.fill) await page.fill(step.fill[0], step.fill[1], step.timeout ? { timeout: step.timeout } : {})
          if (step.press) await page.keyboard.press(step.press)
          await page.waitForTimeout(SETTLE_PAUSE_MS)
          mine.push({ n, label: step.label, at_ms: at, profile, shot })
        }
      } catch (error) {
        result.failed.push({ profile, reason: `step ${mine.length + 1}: ${String(error.message).split('\n')[0]}` })
      }
      const duration = Date.now() - started
      await context.close() // the video is saved when the context closes
      const videoName = `walkthrough-${profile}.webm`
      try { await rename(await video.path(), join(outDir, videoName)) } catch { result.failed.push({ profile, reason: 'the video was not written' }) }
      const hasVideo = !result.failed.some((f) => f.profile === profile && f.reason === 'the video was not written')
      for (const s of mine) result.steps.push({ ...s, video: hasVideo ? videoName : null })
      if (hasVideo) {
        result.videos.push({ profile, file: videoName, width, height, duration_ms: duration })
        result.captures.push({ path: videoName, alt: `Recorrido${several ? ` ${profile === 'phone' ? 'teléfono' : 'escritorio'}` : ''} · ${clock(duration)}`, masked, place, as })
      }
      for (const s of mine) result.captures.push({ path: s.shot, alt: `${clock(s.at_ms)} · Paso ${s.n} · ${s.label}${several ? ` (${profile === 'phone' ? 'teléfono' : 'escritorio'})` : ''}`, masked, place, as })
    }
  } finally {
    await browser.close()
  }
  await writeFile(join(outDir, 'steps.json'), JSON.stringify(result.steps, null, 2))
  await writeFile(join(outDir, 'captures.json'), JSON.stringify(result.captures, null, 2))
  return result
}

/** Width and height of a WebM from its header: the PixelWidth and PixelHeight elements (IDs 0xB0 and 0xBA, 2 bytes each). null when it is not a WebM or they are not there. */
export function webmSize (bytes) {
  const b = Buffer.from(bytes)
  if (b.length < 4 || b[0] !== 0x1a || b[1] !== 0x45 || b[2] !== 0xdf || b[3] !== 0xa3) return null
  const head = b.subarray(0, Math.min(b.length, 4096))
  const find = (id) => { for (let i = 0; i < head.length - 4; i++) if (head[i] === id && head[i + 1] === 0x82) return head.readUInt16BE(i + 2); return null }
  const width = find(0xb0)
  const height = find(0xba)
  return width && height ? { width, height } : null
}

/** The CLI of `team walkthrough`: `--url`, `--steps <json|file>`, `--profile desktop|phone|both`, `--out <dir>`, `--place`, `--as`, `--masked true|false`. */
export async function runWalkthrough (options, env = process.env) {
  const need = (k) => { if (typeof options[k] !== 'string' || options[k].trim() === '') throw new Error(`team walkthrough: --${k} is required.`); return options[k] }
  const url = need('url')
  const raw = need('steps')
  let steps
  try { steps = JSON.parse(raw.trim().startsWith('[') ? raw : await readFile(raw, 'utf8')) } catch { throw new Error('team walkthrough: --steps is a JSON list or the path of a file with it.') }
  const profile = options.profile ?? 'desktop'
  const profiles = profile === 'both' ? ['desktop', 'phone'] : [profile]
  const outDir = options.out ?? env.TEAM_CAPTURES_DIR
  if (!outDir) throw new Error('team walkthrough: --out or $TEAM_CAPTURES_DIR is required.')
  let playwright = null
  try { playwright = await import('playwright') } catch { /* without Playwright the walkthrough says so in one line */ }
  if (!playwright) return { steps: [], captures: [], videos: [], failed: [{ profile, reason: 'no browser: Playwright is not installed on this host' }] }
  return recordWalkthrough({ url, steps, profiles, outDir, place: need('place'), as: need('as'), masked: options.masked === 'true', playwright })
}
