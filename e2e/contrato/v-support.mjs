// Shared by the V rows (the view of one message): the same rich message, and the geometry of what a person sees.
import { FILES, settled } from './harness.mjs'

export const VIEWPORTS = [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }]

/** Different pictures: the PNG decodes the same, the bytes (and so the hash) differ. */
export const photo = (n, name = `captura-${n}.png`) => ({ ...FILES.photo(name), buffer: Buffer.concat([FILES.photo().buffer, Buffer.from(`variante-${n}-${Math.random()}`)]) })

/** A long description of several paragraphs, as people paste them. */
export const longBody = (title) => [title, ...Array.from({ length: 14 }, (_, i) => `Párrafo ${i + 1}: desde el modal no se puede descargar el archivo y la persona lo menciona como uno más de una seguidilla de problemas muy importante en esa pantalla.`)].join('\n')

/** The message of the drawing: authored by Ana, sent to Claude and Carla, with a photo, a second photo, a video, an audio and a PDF. */
export async function richMessage (h, title, { as = 'ana', recipients = ['claude', 'carla'], files, body } = {}) {
  const text = body ?? `${title}\nDesde el modal no se puede descargar el PDF. La persona lo menciona como uno más de una seguidilla de problemas.`
  return h.message(text, { as, recipients, files: files ?? [photo(1), photo(2), FILES.video(), FILES.audio(), FILES.pdf()] })
}

/** Opens the view of a message as `who` and waits until it is still. */
export async function openDetail (h, who, id, viewport, { gallery = true } = {}) {
  const opened = await h.open(who, { viewport })
  await opened.page.goto(`${h.origin}/messages/${id}`)
  await opened.page.locator('main h1').waitFor()
  if (gallery) await opened.page.locator('[data-gallery]').first().waitFor({ timeout: 10000 })
  await settled(opened.page)
  return opened
}

/** The box of an element (null when it is not drawn). */
export const box = async (locator) => ((await locator.count()) ? locator.first().boundingBox() : null)
