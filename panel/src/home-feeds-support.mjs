// Shared by fits-one-screen and flows-inicio: the two lists of Inicio, measured in the page, and the message lists the server answers, cut to a size (UD-253, H-3718).

/** Every list of messages the panel asks for comes back with `n` rows: 0 empties both lists of Inicio, `Infinity` leaves them as the server has them. */
export async function cutMessages(page, n) {
  await page.route(/\/api\/messages(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    const list = Array.isArray(body) ? body : body.items
    const items = list.slice(0, n)
    return route.fulfill({ response, json: Array.isArray(body) ? items : { ...body, items } })
  })
}

/**
 * Runs in the page. The two lists of Inicio, and what is wrong with their boxes:
 * on a desktop both measure the same (width, height and top, within 1 px), and the height is the content of the taller one (its padding,
 * its header and its framed rows, or the line that says it is empty) and never more; on a phone each box is as tall as its own content.
 * A box is never taller than the room the page leaves for the lists.
 */
export function feedsInPage() {
  const boxes = [...document.querySelectorAll('section[aria-label="Últimos mensajes"], section[aria-label="Últimas respuestas"]')]
  const failures = []
  if (boxes.length !== 2) return { failures: [`there are ${boxes.length} lists of Inicio on screen, not 2`], boxes: [] }
  const px = (v) => parseFloat(v) || 0
  const measured = boxes.map((box) => {
    const r = box.getBoundingClientRect()
    const css = getComputedStyle(box)
    const [header, slot] = box.children
    const frame = slot?.firstElementChild
    // What the box holds: its padding and borders, the header, the gap and the frame of the rows (or of the empty line).
    const content = px(css.paddingTop) + px(css.paddingBottom) + px(css.borderTopWidth) + px(css.borderBottomWidth) + header.getBoundingClientRect().height + px(css.rowGap) + (frame?.getBoundingClientRect().height ?? 0)
    return { name: box.getAttribute('aria-label'), x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, content, rows: box.querySelectorAll('article').length, pager: /\d+–\d+ de \d+/.test(box.textContent ?? '') }
  })
  const [a, b] = measured
  const stacked = Math.abs(a.x - b.x) <= 1 && b.y > a.y
  if (!stacked) {
    if (Math.abs(a.width - b.width) > 1) failures.push(`the two lists differ in width: ${Math.round(a.width)} px and ${Math.round(b.width)} px`)
    if (Math.abs(a.height - b.height) > 1) failures.push(`the two lists differ in height: ${Math.round(a.height)} px and ${Math.round(b.height)} px`)
    if (Math.abs(a.y - b.y) > 1) failures.push(`the two lists do not start at the same height: ${Math.round(a.y)} px and ${Math.round(b.y)} px`)
    const need = Math.max(a.content, b.content)
    for (const box of measured) if (box.height > need + 1) failures.push(`${box.name} measures ${Math.round(box.height)} px and the taller content is ${Math.round(need)} px (${box.rows} rows)`)
    const room = document.querySelector('[data-testid="home-feeds-room"]')?.getBoundingClientRect()
    if (room) for (const box of measured) if (box.bottom > room.bottom + 1) failures.push(`${box.name} ends at ${Math.round(box.bottom)} px, under the room that ends at ${Math.round(room.bottom)} px`)
  } else {
    for (const box of measured) if (box.height > box.content + 1) failures.push(`${box.name} measures ${Math.round(box.height)} px and its content ${Math.round(box.content)} px (${box.rows} rows)`)
  }
  return { failures, boxes: measured }
}
