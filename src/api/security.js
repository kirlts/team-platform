// Cabeceras de seguridad (MASTER-SPEC §4.1): el panel no se conecta a ningún otro dominio.
// Se fijan en `onRequest` para que lleguen también a las respuestas SSE, que escriben sobre `reply.raw`.

export function contentSecurityPolicy (config) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Radix y Tailwind escriben estilos en línea; sin esto los componentes de shadcn/ui pierden su posición.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:", // MS §4.1
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'", // MS §4.1: excluye cualquier telemetría de una librería
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${config.frameAncestors}`
  ].join('; ')
}

export function installSecurityHeaders (app, config) {
  const csp = contentSecurityPolicy(config)
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('content-security-policy', csp)
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'same-origin')
  })
}
