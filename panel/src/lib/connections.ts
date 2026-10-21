/** The connections UD-012 names, in the order of the mockup's menu; none can be used yet. */
export const CONNECTIONS = ['api', 'mcp', 'email', 'whatsapp', 'github'] as const
export type Connection = (typeof CONNECTIONS)[number]

export const isConnection = (value: string | undefined): value is Connection => !!value && (CONNECTIONS as readonly string[]).includes(value)
