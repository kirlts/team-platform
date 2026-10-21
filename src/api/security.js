// Security headers (MASTER-SPEC §4.1): the panel connects to no other domain.
// They are set in `onRequest` so they also reach SSE responses, which write on `reply.raw`.

export function contentSecurityPolicy (config) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // Radix and Tailwind write inline styles; without this the shadcn/ui components lose their positioning.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:", // MS §4.1
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self'", // MS §4.1: rules out any telemetry from a library
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
