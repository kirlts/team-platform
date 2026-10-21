/**
 * Where running text is justified (UD-022, UD-034). A justified paragraph that is too narrow opens gaps between words:
 * at 390 px they reach 20 px (J3-A-21). So a `.prose-block` is justified only while its own width is at least
 * `JUSTIFY_MIN_REM`, and aligns to the left below it.
 *
 * 29.2 rem (438 px at the 15 px root) is measured, not chosen: `npm run build && node scripts/medir-justificado.mjs`
 * lays out every paragraph of the sample data in containers from 200 to 800 px, with the panel's font, and measures the
 * space between words line by line. At 1440 px, where the owner saw the text justified, the largest gap was 14.2 px; 438 px
 * is the narrowest width from which no wider container, in a sweep of 2 px steps, goes over it. The same sweep with the
 * 17 px of a message body gives 404 px, so the larger one holds for both. The corpus and the corrida are in UD-034.
 */
export const JUSTIFY_MIN_REM = 29.2

/** Marks each `.prose-block` that is wide enough with `data-wide`; the stylesheet justifies those. Returns the function that stops it. */
export function watchProse(root: HTMLElement = document.body): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {}
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 15
  const min = JUSTIFY_MIN_REM * rem
  const resizes = new ResizeObserver((entries) => {
    for (const entry of entries) entry.target.toggleAttribute('data-wide', entry.contentRect.width >= min)
  })
  const watched = new WeakSet<Element>()
  const watch = (el: Element) => {
    if (watched.has(el)) return
    watched.add(el)
    resizes.observe(el)
  }
  const scan = (node: Element) => {
    if (node.matches('.prose-block')) watch(node)
    node.querySelectorAll('.prose-block').forEach(watch)
  }
  const mutations = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach((n) => n.nodeType === Node.ELEMENT_NODE && scan(n as Element))
  })
  mutations.observe(root, { childList: true, subtree: true })
  scan(root)
  return () => {
    resizes.disconnect()
    mutations.disconnect()
  }
}
