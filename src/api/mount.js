// Mount point of the panel (H-3721): the server writes it into index.html when it serves it, so one build of the panel
// serves any path. Shared with the development double server (panel/dev-server.mjs).

const attr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * The panel's index.html with its mount point: the base path and the API prefix as two meta tags the panel reads
 * (panel/src/lib/base.ts), the asset references under the base, and the host's theme after the panel's own stylesheet.
 * `basePath` ends with `/`; `apiPrefix` does not.
 */
export function mountedIndex (html, { basePath, apiPrefix, themeCss = '' }) {
  const metas = `<meta name="team-base-path" content="${attr(basePath)}" /><meta name="team-api-base" content="${attr(apiPrefix)}" />`
  const theme = themeCss ? `<link rel="stylesheet" href="${attr(basePath)}theme.css" />` : ''
  return html
    .replace(/(\s(?:src|href))="\.?\/assets\//g, `$1="${basePath}assets/`)
    .replace(/<\/head>/i, (end) => `${metas}${theme}${end}`)
}
