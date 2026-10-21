/**
 * Views whose page is allowed to scroll (UD-123). Dueño, 2026-10-21: «La parte para escribir la descripción del proyecto tiene texto
 * truncado que obliga a desplazarse dentro de la misma página para escribir la configuración del proyecto. Eso es un gran problema.»
 * Configuración holds a project description that can be as long as a master spec; the fix is not a smaller frame with a scroll inside it but an
 * editor as tall as its text, and the page (the `<main>` of the shell) is what scrolls. These views are exempt ONLY from the checks of document
 * height, region height and content below the window edge; own lanes, hidden overflow, text under 12 px and repeated text still apply to them.
 */
export const SCROLLING_PAGES = [{ name: 'configuración', path: '/settings' }]
